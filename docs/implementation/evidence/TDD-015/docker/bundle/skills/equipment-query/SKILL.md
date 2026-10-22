---
name: equipment-query
description: Query a single equipment's current status and temperature through the bound get_equipment Tool, report only returned facts, ask for a missing equipmentId, and never fabricate data on Tool failure.
---

# equipment-query

Query a single piece of equipment's current status and temperature through the
bound `get_equipment` Tool, then report the facts to the user.

## Purpose

Use this Skill when the user asks for the state, health, running status or
temperature of a specific piece of equipment. This Skill is business
instructions plus a Tool adapter; it does not run external scripts.

## Input

The only accepted model input for `get_equipment` is:

- `equipmentId` (string, required, nonblank): the equipment identifier, for
  example `PUMP-001`.

Do not send any other field. In particular, never invent or pass `actorId`,
`endpoint`, credentials, URLs, headers or timeout settings as model arguments.
Identity, authentication and endpoint are owned by the bound transport, not by
the conversation.

## Invocation steps

1. Extract the equipment identifier from the user's message.
2. If no equipment identifier is present, do not guess one and do not call any
   business Tool. Ask the user which equipment they mean.
3. Call `get_equipment` exactly once with:
   ```json
   {"equipmentId": "<equipment id>"}
   ```
4. Read only the returned fields. Do not add sensors, thresholds, causes or
   recommendations that the Tool did not return.
5. Produce a short equipment report from the facts.

## Response fields

The successful response is a four-field object:

- `equipmentId` (string): the identifier that was queried.
- `status` (string): the reported status, for example `normal`, `warning` or
  `fault`.
- `temperatureCelsius` (integer or long): the reported temperature in degrees
  Celsius. Preserve the exact value, including `0` and negative temperatures.
- `source` (string): provenance of the facts. Always cite it in the report.

Expected report shape (`equipment-report@1`):

```
equipmentId: PUMP-001
status: warning
temperatureCelsius: 86
source: seed-equipment-001@1
```

## Error and no-fabrication handling

- If the Tool fails (timeout, transport error, unavailable service), do not
  retry in a loop and do not fabricate status, temperature or source. Tell the
  user the query failed and that no current facts are available. Clearly
  surface the Tool error as evidence.
- If the response is rejected as `TOOL_RESPONSE_CONTRACT_INVALID`, treat it as a
  failed query: no facts are trustworthy. Do not repair, coerce or invent
  missing fields.
- If input is invalid (`TOOL_INPUT_CONTRACT_INVALID`), ask for a valid
  nonblank `equipmentId` and make no business Tool call.
- Never present cached, assumed or model-generated equipment state as if it
  came from the Tool.
