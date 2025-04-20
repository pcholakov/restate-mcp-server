# Requirements

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- Build: `npm run build` (TypeScript compilation)
- Run: `npm run server:dev` (Run with tsx directly)
- The server receives commands via stdio

## Code Style Guidelines
- TypeScript with strict mode enabled
- ES modules (import/export syntax)
- Target: ES2022, Node16 module resolution
- Consistent casing in filenames required

## Structure
- Source code in `src/` directory
- Built files output to `build/` directory

## Dependencies
- Primary: `@modelcontextprotocol/sdk` for MCP server implementation
- Validation: `zod` for schema validation
- No testing framework currently configured

## Restate API Integration
- Service management is done via Restate Admin API (default: http://localhost:9070)
- API schemas defined following the OpenAPI spec in resources/openapi-admin.json
- All API requests include `User-Agent: restate-mcp-server/0.0.1`

## Formatting & Naming
- Prefer camelCase for variables and functions
- PascalCase for classes and types
- Use descriptive names for variables and functions
- Add type annotations for function parameters and return values

## Functionality
- Expose basic list/get/update/delete functionality for managing services and deployments
- Restate supports plain Services which don't have long-lived state beyond an invocation, Virtual Objects, which have durable long-lived identity, and Workflows which are like Virtual Objects but can only execute once, with a specific idempotency key, and provide a nicer way to model long-running event-driven processes
- Expose tools based on the Introspection API to allow for querying running invocations, as well as cancel or kill stuck ones
- Provide SQL querying capabilities over KV state via the `/query` endpoint with the query-kv-state tool
- Support viewing service state data with appropriate error handling for different response types

---

# What is Restate?

Restate is a durable execution engine and a suite of SDKs that allow services to be built. Restate acts as a request orchestrator between the caller and the service logic, journaling every processing step. This enables highly robust and correct distribued sytems to be easily built by anyone. There are three core types of Restate services: stateless services (aka just "services"), virtual objects (which provide linearizable access to shared state), and workflows (which are a special case of virtual objects, with run-once semantics and unique execution ids with convenient signals for external events to trigger workflow transitions).

Restate is a partitioned system with keys mapped to distinct internal partitions. Stateless services have an implicit, uniquely-generated key assigned by the system. Stateful services (virtual objects and workflows) have an explicitly provided key that defines the identity of the object. With workflows, that identity becomes the execution id - which cannot be reused once the workflow completes. Stateful services can persist bits of state - usually small, on the order of a few KB - internally within Restate, and access it with the same linearizable semantics as other interactions.

Restate handles idempotency, retries, queueing, and event ordrering within the system, while providing an external HTTP and Kafka request/event ingress capabilities. Within Restate, services can invoke other services with guaranteed delivery and exactly-once-processing semantics. External invocations via the ingress interface should provide an idempotency key to obtain the same guarantees. Restate also allows the system state (both data and metadata) to be introspected via an SQL-based query interface.

---

# Introspection SQL schema reference

## Table: state

| Column name | Type | Description |
| --- | --- | --- |
| `partition_key` | `UInt64` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| `service_name` | `Utf8` | The name of the invoked service. |
| `service_key` | `Utf8` | The key of the Virtual Object. |
| `key` | `Utf8` | The `utf8` state key. |
| `value_utf8` | `Utf8` | Only contains meaningful values when a service stores state as `utf8`. This is the case for services that serialize state using JSON (default for Typescript SDK, Java/Kotlin SDK if using JsonSerdes). |
| `value` | `Binary` | A binary, uninterpreted representation of the value. You can use the more specific column `value_utf8` if the value is a string. |

## Table: sys\_journal

| Column name | Type | Description |
| --- | --- | --- |
| `partition_key` | `UInt64` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| `id` | `Utf8` | [Invocation ID](https://docs.restate.dev/operate/invocation#invocation-identifier). |
| `index` | `UInt32` | The index of this journal entry. |
| `entry_type` | `Utf8` | The entry type. You can check all the available entry types in [`entries.rs`](https://github.com/restatedev/restate/blob/main/crates/types/src/journal/entries.rs). |
| `name` | `Utf8` | The name of the entry supplied by the user, if any. |
| `completed` | `Boolean` | Indicates whether this journal entry has been completed; this is only valid for some entry types. |
| `invoked_id` | `Utf8` | If this entry represents an outbound invocation, indicates the ID of that invocation. |
| `invoked_target` | `Utf8` | If this entry represents an outbound invocation, indicates the invocation Target. Format for plain services: `ServiceName/HandlerName`, e.g. `Greeter/greet`. Format for virtual objects/workflows: `VirtualObjectName/Key/HandlerName`, e.g. `Greeter/Francesco/greet`. |
| `sleep_wakeup_at` | `TimestampMillisecond` | If this entry represents a sleep, indicates wakeup time. |
| `promise_name` | `Utf8` | If this entry is a promise related entry (GetPromise, PeekPromise, CompletePromise), indicates the promise name. |
| `raw` | `Binary` | Raw binary representation of the entry. Check the [service protocol](https://github.com/restatedev/service-protocol) for more details to decode it. |
| `version` | `UInt32` | The journal version. |
| `entry_json` | `Utf8` | The entry serialized as a JSON string (only relevant for journal version 2) |
| `appended_at` | `TimestampMillisecond` | When the entry was appended to the journal |

## Table: sys\_keyed\_service\_status

| Column name | Type | Description |
| --- | --- | --- |
| `partition_key` | `UInt64` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| `service_name` | `Utf8` | The name of the invoked virtual object/workflow. |
| `service_key` | `Utf8` | The key of the virtual object/workflow. |
| `invocation_id` | `Utf8` | [Invocation ID](https://docs.restate.dev/operate/invocation#invocation-identifier). |

## Table: sys\_inbox

| Column name | Type | Description |
| --- | --- | --- |
| `partition_key` | `UInt64` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| `service_name` | `Utf8` | The name of the invoked virtual object/workflow. |
| `service_key` | `Utf8` | The key of the virtual object/workflow. |
| `id` | `Utf8` | [Invocation ID](https://docs.restate.dev/operate/invocation#invocation-identifier). |
| `sequence_number` | `UInt64` | Sequence number in the inbox. |
| `created_at` | `TimestampMillisecond` | Timestamp indicating the start of this invocation. DEPRECATED: you should not use this field anymore, but join with the sys\_invocation table |

## Table: sys\_idempotency

| Column name | Type | Description |
| --- | --- | --- |
| `partition_key` | `UInt64` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| `service_name` | `Utf8` | The name of the invoked service. |
| `service_key` | `Utf8` | The key of the virtual object or the workflow ID. Null for regular services. |
| `service_handler` | `Utf8` | The invoked handler. |
| `idempotency_key` | `Utf8` | The user provided idempotency key. |
| `invocation_id` | `Utf8` | [Invocation ID](https://docs.restate.dev/operate/invocation#invocation-identifier). |

## Table: sys\_promise

| Column name | Type | Description |
| --- | --- | --- |
| `partition_key` | `UInt64` | Internal column that is used for partitioning the services invocations. Can be ignored. |
| `service_name` | `Utf8` | The name of the workflow service. |
| `service_key` | `Utf8` | The workflow ID. |
| `key` | `Utf8` | The promise key. |
| `completed` | `Boolean` | True if the promise was completed. |
| `completion_success_value` | `Binary` | The completion success, if any. |
| `completion_success_value_utf8` | `Utf8` | The completion success as UTF-8 string, if any. |
| `completion_failure` | `Utf8` | The completion failure, if any. |

## Table: sys\_service

| Column name | Type | Description |
| --- | --- | --- |
| `name` | `Utf8` | The name of the registered user service. |
| `revision` | `UInt64` | The latest deployed revision. |
| `public` | `Boolean` | Whether the service is accessible through the ingress endpoint or not. |
| `ty` | `Utf8` | The service type. Either `service` or `virtual_object` or `workflow`. |
| `deployment_id` | `Utf8` | The ID of the latest deployment |

## Table: sys\_deployment

| Column name | Type | Description |
| --- | --- | --- |
| `id` | `Utf8` | The ID of the service deployment. |
| `ty` | `Utf8` | The type of the endpoint. Either `http` or `lambda`. |
| `endpoint` | `Utf8` | The address of the endpoint. Either HTTP URL or Lambda ARN. |
| `created_at` | `TimestampMillisecond` | Timestamp indicating the deployment registration time. |
| `min_service_protocol_version` | `UInt32` | Minimum supported protocol version. |
| `max_service_protocol_version` | `UInt32` | Maximum supported protocol version. |

## Table: sys\_invocation

| Column name | Type | Description |
| --- | --- | --- |
| `id` | `Utf8` | [Invocation ID](https://docs.restate.dev/operate/invocation#invocation-identifier). |
| `target` | `Utf8` | Invocation Target. Format for plain services: `ServiceName/HandlerName`, e.g. `Greeter/greet`. Format for virtual objects/workflows: `VirtualObjectName/Key/HandlerName`, e.g. `Greeter/Francesco/greet`. |
| `target_service_name` | `Utf8` | The name of the invoked service. |
| `target_service_key` | `Utf8` | The key of the virtual object or the workflow ID. Null for regular services. |
| `target_handler_name` | `Utf8` | The invoked handler. |
| `target_service_ty` | `Utf8` | The service type. Either `service` or `virtual_object` or `workflow`. |
| `idempotency_key` | `Utf8` | Idempotency key, if any. |
| `invoked_by` | `Utf8` | Either: \* `ingress` if the invocation was created externally. \* `service` if the invocation was created by another Restate service. \* `subscription` if the invocation was created by a subscription (e.g. Kafka). |
| `invoked_by_service_name` | `Utf8` | The name of caller service if `invoked_by = 'service'`. |
| `invoked_by_id` | `Utf8` | The caller [Invocation ID](https://docs.restate.dev/operate/invocation#invocation-identifier) if `invoked_by = 'service'`. |
| `invoked_by_subscription_id` | `Utf8` | The subscription id if `invoked_by = 'subscription'`. |
| `invoked_by_target` | `Utf8` | The caller invocation target if `invoked_by = 'service'`. |
| `pinned_deployment_id` | `Utf8` | The ID of the service deployment that started processing this invocation, and will continue to do so (e.g. for retries). This gets set after the first journal entry has been stored for this invocation. |
| `pinned_service_protocol_version` | `UInt32` | The negotiated protocol version used for this invocation. This gets set after the first journal entry has been stored for this invocation. |
| `trace_id` | `Utf8` | The ID of the trace that is assigned to this invocation. Only relevant when tracing is enabled. |
| `journal_size` | `UInt32` | The number of journal entries durably logged for this invocation. |
| `journal_commands_size` | `UInt32` | The number of commands generated by this invocation, stored in the journal. Only relevant when pinned\_service\_protocol\_version >= 4. |
| `created_at` | `TimestampMillisecond` | Timestamp indicating the start of this invocation. |
| `modified_at` | `TimestampMillisecond` | Timestamp indicating the last invocation status transition. For example, last time the status changed from `invoked` to `suspended`. |
| `inboxed_at` | `TimestampMillisecond` | Timestamp indicating when the invocation was inboxed, if ever. |
| `scheduled_at` | `TimestampMillisecond` | Timestamp indicating when the invocation was scheduled, if ever. |
| `running_at` | `TimestampMillisecond` | Timestamp indicating when the invocation first transitioned to running, if ever. |
| `completed_at` | `TimestampMillisecond` | Timestamp indicating when the invocation was completed, if ever. |
| `retry_count` | `UInt64` | The number of invocation attempts since the current leader started executing it. Increments on start, so a value greater than 1 means a failure occurred. Note: the value is not a global attempt counter across invocation suspensions and leadership changes. |
| `last_start_at` | `TimestampMillisecond` | Timestamp indicating the start of the most recent attempt of this invocation. |
| `next_retry_at` | `TimestampMillisecond` | Timestamp indicating the start of the next attempt of this invocation. |
| `last_attempt_deployment_id` | `Utf8` | The ID of the service deployment that executed the most recent attempt of this invocation; this is set before a journal entry is stored, but can change later. |
| `last_attempt_server` | `Utf8` | Server/SDK version, e.g. `restate-sdk-java/1.0.1` |
| `last_failure` | `Utf8` | An error message describing the most recent failed attempt of this invocation, if any. |
| `last_failure_error_code` | `Utf8` | The error code of the most recent failed attempt of this invocation, if any. |
| `last_failure_related_entry_index` | `UInt64` | The index of the journal entry that caused the failure, if any. It may be out-of-bound of the currently stored entries in `sys_journal`. DEPRECATED: you should not use this field anymore, but last\_failure\_related\_command\_index instead. |
| `last_failure_related_entry_name` | `Utf8` | The name of the journal entry that caused the failure, if any. DEPRECATED: you should not use this field anymore, but last\_failure\_related\_command\_name instead. |
| `last_failure_related_entry_type` | `Utf8` | The type of the journal entry that caused the failure, if any. You can check all the available entry types in [`entries.rs`](https://github.com/restatedev/restate/blob/main/crates/types/src/journal/entries.rs). DEPRECATED: you should not use this field anymore, but last\_failure\_related\_command\_type instead. |
| `last_failure_related_command_index` | `UInt64` | The index of the command in the journal that caused the failure, if any. It may be out-of-bound of the currently stored commands in `sys_journal`. |
| `last_failure_related_command_name` | `Utf8` | The name of the command that caused the failure, if any. |
| `last_failure_related_command_type` | `Utf8` | The type of the command that caused the failure, if any. You can check all the available command types in [`entries.rs`](https://github.com/restatedev/restate/blob/main/crates/types/src/journal_v2/command.rs). |
| `status` | `Utf8` | Either `pending` or `scheduled` or `ready` or `running` or `backing-off` or `suspended` or `completed`. |
| `completion_result` | `Utf8` | If `status = 'completed'`, this contains either `success` or `failure` |
| `completion_failure` | `Utf8` | If `status = 'completed' AND completion_result = 'failure'`, this contains the error cause |