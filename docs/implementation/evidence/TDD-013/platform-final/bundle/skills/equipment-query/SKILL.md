---
name: equipment-query
description: Query a simulated device's current status, temperature, and data source by equipment ID using the bound get_equipment tool. Use when the user asks for the state or temperature of a specific piece of equipment.
---

# Equipment Query

Query simulated equipment facts through the bound `get_equipment` tool. The tool adapter
already owns HTTP transport, authentication references, and timeout handling. Never ask the
user for credentials, an endpoint, or an identity token.

## Steps

1. Extract `equipmentId` from the user request. It must be a non-blank string such as
   `PUMP-001`. Do not add `actorId`, `endpoint`, credentials, or any other field; the tool
   accepts only `equipmentId` and rejects extra inputs.
2. If `equipmentId` is missing or blank, stop and ask the user for the equipment ID. Do not
   call any tool and do not guess an ID.
3. Invoke `get_equipment` with exactly `{ "equipmentId": "<id>" }`. Do not pass endpoint,
   identity, or transport settings from the model.
4. Read the structured result:
   - `equipmentId`: the equipment identifier that was queried.
   - `status`: the current simulated status (for example `normal` or `warning`).
   - `temperatureCelsius`: the temperature in degrees Celsius as an integer.
   - `source`: the source identifier of the simulated data.
5. Report only these returned facts, quoting the equipment ID, status, temperature, and
   source. You may add a short, clearly labelled recommendation, but never present it as a
   measured fact.

## Error Handling

- If the tool returns `TOOL_INPUT_CONTRACT_INVALID`, the request was malformed. Ask the user
  for a single valid equipment ID and retry; do not invent missing parameters.
- If the tool returns `TOOL_RESPONSE_CONTRACT_INVALID` or the tool fails/times out, report
  that the equipment query failed. Do not fabricate a status, temperature, or source, and do
  not retry with made-up values.
- Never claim a successful query when no successful tool result was received.
