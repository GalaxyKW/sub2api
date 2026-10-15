# Experimental Free account web image bridge

The bridge lets an eligible OpenAI Free OAuth account generate an image through
ChatGPT web while an HTTP Responses client continues using its chat model. The
same provider serves account image tests and a restricted Images generation API.
The feature depends on ChatGPT web behavior and is experimental.

## Enable an account

In account settings, enable **Free web image bridge**, allow creating retained
regular ChatGPT conversations, and explicitly allow at least one image model in
the account's model mapping. Choose an allowed image entry as the chat default.
The API key's group must also allow images. Empty or unrestricted chat mappings
do not authorize the bridge to generate images.

The bridge setting is independent of the Hosted image tool policy. Accounts that
have never configured the bridge retain the existing Codex route. Explicitly
disabling a previously configured bridge prevents it from generating images;
ordinary chat remains available.

The image model names are compatibility entries. ChatGPT web selects its actual
image backend; an entry such as `gpt-image-2` does not guarantee that API model.
The optional compressed preview displays the result in ordinary chat messages.
Manual and scheduled account image tests are capability checks and do not
reactivate paused/error accounts or reset Codex rate-limit/403 state.

## Persistent storage

Job claims and results must survive process restarts to prevent a retried request
from generating or billing the same image again. The directory is selected in
this order:

1. `SUB2API_WEB_IMAGE_STATE_DIR`, if set (must be an absolute path).
2. `DATA_DIR/web-image-jobs`, if `DATA_DIR` is set in the application process.
3. `/app/data/web-image-jobs`.

The supplied Docker Compose files pass through `SUB2API_WEB_IMAGE_STATE_DIR`.
Their existing `/app/data` volume covers the default directory. If you override
the directory, mount that container path on persistent storage too. For a binary
or systemd deployment, set `DATA_DIR` to the service's writable persistent data
directory, or set the explicit override in the service environment.

The directory contains generated images and internal conversation/result
metadata. New directories use mode `0700` and job records use `0600`; existing
directories must already have access restricted to the service user. Include
the directory in backups. Deleting it while requests can still be retried loses
deduplication and billing history. Disabling the bridge does not delete stored
results or retained conversations on ChatGPT web.

The current store supports one application instance. Independent local disks
cannot deduplicate across replicas; a shared directory alone does not provide
distributed execution and billing guarantees.

## Limits and retry behavior

- The Images API accepts an omitted `size`, `auto`, or `WIDTHxHEIGHT` (for
  example, `1024x1024`, `1536x1024`, or `1024x1536`). Each dimension must be
  between 64 and 4096 pixels, with at most 16,777,216 pixels in total. `auto`
  preserves the generated PNG at its original resolution. An explicit size
  adds an aspect-ratio and subject-safe-area instruction to the web prompt;
  after generation, the server scales proportionally and center-crops if
  necessary to return those exact pixel dimensions. This can crop edges or
  upscale the image; it does not promise native generation at that resolution.
  The response's `size` and usage dimensions describe the returned PNG. When
  adaptation occurs, `X-Sub2API-Image-Size-Adaptation: resize-center-crop` and
  `X-Sub2API-Image-Original-Size` identify it. This applies to Images API calls
  such as Cherry Studio's image panel; ordinary chat previews are unchanged.
- One text-to-image PNG per request. No image editing, reference-image
  continuation, batches, transparent output, WebSocket Responses, or
  `previous_response_id` continuation. Unsupported controls are rejected.
- Claims/results have a 24-hour replay window. Expired records are removed
  lazily when a new job needs storage, not immediately at 24 hours.
- The store permits at most 512 MiB in total and 32 MiB per record. A full or
  unwritable store rejects a new job before contacting the provider.
- Provider calls have a four-minute timeout; background jobs have a five-minute
  deadline. A disconnected client does not cancel an accepted job.
- Retrying the same request can retrieve its stored result. If a job might have
  been accepted but its outcome is unknown, the bridge returns an error rather
  than silently submitting it again.
- A provider failure that explicitly confirms generation never started releases
  the job claim, allowing a later retry of the same request. Failures after a
  possible submission, unknown errors, and interrupted pending claims remain
  protected from duplicate generation. The bridge does not automatically submit
  a second generation. Safe diagnostic logs record the stage, error category,
  upstream status, and whether generation may have started, without credentials,
  prompts, or upstream response bodies.

The image concurrency limit also applies when a normal chat request selects the
bridge tool. A newly started background job holds its slot until generation ends,
including after client disconnection. Replaying an existing job does not acquire
another generation slot. This setting limits concurrent work, not daily image
quota.
