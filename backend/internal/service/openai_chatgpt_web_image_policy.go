package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/tidwall/gjson"
)

const AccountExtraChatGPTWebImageDefaultModel = "chatgpt_web_image_default_model"

// A model here is a locally authorized compatibility entry. The web provider
// selects its own image backend; this is never evidence of its actual model ID.
type chatGPTWebImageModel struct {
	RequestedModel string
	MappedModel    string
}

func isFreeChatGPTWebImageAccount(account *Account) bool {
	return account != nil && account.IsOpenAIOAuth() && strings.EqualFold(strings.TrimSpace(account.GetCredential("plan_type")), "free")
}

// A missing flag preserves the original upstream behavior. Explicit false is
// different: it disables web images and removes stale image tools/history.
func chatGPTWebImageConfigured(account *Account) bool {
	if account == nil {
		return false
	}
	_, configured := account.Extra[AccountExtraChatGPTWebImageEnabled].(bool)
	return configured
}

// UsesChatGPTWebImagePolicy selects the web image provider policy only when
// explicitly configured; unsupported opt-ins are rejected by account validation.
func UsesChatGPTWebImagePolicy(account *Account) bool {
	return (isFreeChatGPTWebImageAccount(account) && chatGPTWebImageConfigured(account)) || chatGPTWebImageEnabled(account)
}

func chatGPTWebDefaultImageModel(account *Account) string {
	if account != nil {
		if model, _ := account.Extra[AccountExtraChatGPTWebImageDefaultModel].(string); strings.TrimSpace(model) != "" {
			return strings.TrimSpace(model)
		}
	}
	return "gpt-image-2"
}

// Unlike the ordinary account allowlist (where empty means unrestricted), web
// images require an explicit image mapping. Keep that stronger opt-in local to
// this provider instead of changing existing text/passthrough model semantics.
func resolveChatGPTWebImageModel(account *Account, requested string) (chatGPTWebImageModel, error) {
	if err := validateChatGPTWebImageAccount(account); err != nil {
		return chatGPTWebImageModel{}, err
	}
	requested = strings.TrimSpace(requested)
	if requested == "" {
		requested = chatGPTWebDefaultImageModel(account)
	}
	mapped, matched := account.ResolveMappedModel(requested)
	if !matched || !IsGPTImageGenerationModel(strings.TrimSpace(mapped)) {
		return chatGPTWebImageModel{}, chatGPTWebImageRequestError("chatgpt_web_image_model_not_allowed", "The requested image compatibility model is not explicitly enabled for this account", "model")
	}
	return chatGPTWebImageModel{RequestedModel: requested, MappedModel: strings.TrimSpace(mapped)}, nil
}

type chatGPTWebImageSchedulingModelContextKey struct{}

// Scheduling must apply the same opt-in and model authorization as forwarding.
// An empty ordinary model mapping allows chat, but does not grant web images.
// Accounts without an explicit web image policy retain their upstream route.
func chatGPTWebImageSchedulingFailureReason(ctx context.Context, account *Account, requested string) string {
	if !UsesChatGPTWebImagePolicy(account) {
		return ""
	}
	if ctx != nil {
		if mapped, ok := ctx.Value(chatGPTWebImageSchedulingModelContextKey{}).(string); ok && mapped != "" {
			requested = mapped
		}
	}
	if _, err := resolveChatGPTWebImageModel(account, requested); err != nil {
		if publicErr, ok := err.(*OpenAIImagesUpstreamError); ok {
			return publicErr.Code
		}
		return "chatgpt_web_image_unavailable"
	}
	return ""
}

func isOpenAIImageToolDeclaration(raw any) bool {
	tool, _ := raw.(map[string]any)
	name, _ := tool["name"].(string)
	namespace, _ := tool["namespace"].(string)
	return tool["type"] == "image_generation" ||
		(tool["type"] == "namespace" && name == "image_gen") ||
		isOpenAIImageGenFunctionReference(namespace, name)
}

// PrepareOpenAIImageDisabledRequest keeps ordinary HTTP chat usable when image
// tools are declared by the client on every turn. Explicit selection is denied;
// passive image declarations are removed so no upstream (including Pro) can
// execute them despite the group's disabled image permission.
func PrepareOpenAIImageDisabledRequest(body []byte) ([]byte, error) {
	denied := func() ([]byte, error) {
		return nil, chatGPTWebImageRequestError("image_generation_disabled", ImageGenerationPermissionMessage(), "tools")
	}
	if IsGPTImageGenerationModel(gjson.GetBytes(body, "model").String()) ||
		openAIJSONToolChoiceSelectsExplicitImageGeneration(gjson.GetBytes(body, "tool_choice")) {
		return denied()
	}
	var request map[string]any
	if err := json.Unmarshal(body, &request); err != nil {
		return nil, err
	}
	removed, remaining := 0, 0
	filter := func(raw any) []any {
		tools, _ := raw.([]any)
		kept := make([]any, 0, len(tools))
		for _, tool := range tools {
			if isOpenAIImageToolDeclaration(tool) {
				removed++
				continue
			}
			remaining++
			kept = append(kept, tool)
		}
		return kept
	}
	if raw, exists := request["tools"]; exists {
		request["tools"] = filter(raw)
	}
	if input, ok := request["input"].([]any); ok {
		for _, raw := range input {
			if item, ok := raw.(map[string]any); ok && item["type"] == "additional_tools" {
				item["tools"] = filter(item["tools"])
			}
		}
	}
	if removed == 0 {
		return body, nil
	}
	if request["tool_choice"] == "required" && remaining == 0 {
		return denied()
	}
	return json.Marshal(request)
}
