# Image Job Response Diagnostics Design

## Goal

Capture the external image provider's asynchronous-task response shape from one real reference-image request without exposing credentials or image data.

## Scope

- Add a server-only `IMAGE_RESPONSE_DEBUG=true` switch.
- When enabled, log the provider response's HTTP status and a redacted, size-bounded JSON structure from image generation and image editing calls.
- Leave the public API response and normal production logging unchanged when the switch is absent.
- Use the captured response only to determine the provider's submit, status, success, failure, and image-result fields before implementing job polling.

## Data handling

- Never log authorization headers or API keys.
- Replace data URLs and raw image Base64 fields with metadata only; summarize other long strings with a bounded preview.
- Limit nesting and array samples so a response cannot flood deployment logs.

## Non-goals

- No job polling is added in this diagnostic change.
- No client-side UI or API contract change.
- No retry, persistence, or deployment configuration change.

## Verification

1. With the switch disabled, existing image requests retain their current behavior and logs.
2. With the switch enabled, one real request produces a redacted response-shape log.
3. The log identifies whether the provider responds synchronously with images or asynchronously with a task identifier and status endpoint information.
