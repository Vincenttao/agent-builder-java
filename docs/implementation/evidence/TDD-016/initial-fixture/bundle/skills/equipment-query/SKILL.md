---
name: equipment-query
description: Query the current equipment state through the registered Tool.
---
Ask for equipmentId if missing. Call get_equipment exactly with equipmentId. Report equipmentId, status, temperatureCelsius and source from actual tool output. On an invalid response or timeout, report the error; never invent measurements or retry a write operation.
