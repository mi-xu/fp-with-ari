# State Sync Test Harness

A comprehensive test harness for exercising and validating the state synchronization and batching mechanics of the StateSync system.

## Overview

This harness provides:
- **Server script**: Publishes events with various patterns (steady rate, bursts, etc.)
- **Client script**: Subscribes to events and tracks statistics
- **Integrated scenarios**: End-to-end tests for correctness and performance

## Files

- `server.ts` - Event publishing server with multiple scenarios
- `client.ts` - Event subscriber client with statistics tracking
- `scenarios.ts` - Integrated test scenarios (runs in single process)
- `README.md` - This file

## Quick Start

### Run Integrated Test Scenarios

The easiest way to validate the system:

```bash
bun run test-harness/scenarios.ts
```

This runs 4 comprehensive scenarios:
1. **Basic Correctness** - Validates all events are received
2. **Workspace Isolation** - Tests subscription filtering
3. **High-Frequency Updates** - Tests batching under load
4. **Transaction Processing** - Tests multi-operation events

### Server Usage

Run a test server that publishes events:

```bash
# Basic scenario (default)
bun run test-harness/server.ts

# Custom duration and rate
bun run test-harness/server.ts --duration 60000 --rate 50

# Different scenarios
bun run test-harness/server.ts --scenario rapid-fire --rate 1000
bun run test-harness/server.ts --scenario burst --duration 30000
bun run test-harness/server.ts --scenario workspace-isolation --rate 20
```

#### Server Options

- `--duration <ms>` - How long to run (0 = indefinite, default: 30000)
- `--rate <n>` - Events per second (default: 10)
- `--scenario <name>` - Test scenario to run:
  - `basic` - Steady stream of tab creation events
  - `rapid-fire` - Burst of events as fast as possible
  - `burst` - Alternating bursts and quiet periods
  - `workspace-isolation` - Events across multiple workspaces

### Client Usage

Run a test client that subscribes to events:

```bash
# Basic subscription (default)
bun run test-harness/client.ts

# Custom user and workspaces
bun run test-harness/client.ts --user user-123 --workspaces workspace-1,workspace-2

# Limited duration with verbose logging
bun run test-harness/client.ts --duration 60000 --verbose

# Subscribe to specific entity types
bun run test-harness/client.ts --types window,tab,folder
```

#### Client Options

- `--user <id>` - User ID for subscription (default: test-user-1)
- `--workspaces <ids>` - Comma-separated workspace IDs (default: workspace-1)
- `--types <types>` - Comma-separated entity types to include (default: window,tab)
- `--duration <ms>` - How long to listen (0 = indefinite, default: 0)
- `--verbose` - Log every event received

## Test Scenarios

### Scenario 1: Basic Correctness

Tests that all published events are received by subscribers with correct sequence numbers.

- Publishes 100 events
- Validates all are received
- Checks sequence number continuity
- Detects duplicates

**Expected**: 100% delivery, no gaps, no duplicates

### Scenario 2: Workspace Isolation

Tests that subscription filtering works correctly.

- Publishes 50 events to workspace-1
- Publishes 50 events to workspace-2
- Client 1 subscribes to workspace-1 only
- Client 2 subscribes to workspace-2 only

**Expected**: Each client receives exactly 50 events from their workspace

### Scenario 3: High-Frequency Updates

Tests batching performance under high load.

- Publishes 1000 events as fast as possible
- Measures publish and receive rates
- Validates all events are delivered

**Expected**: High throughput (1000+ events/sec), 100% delivery

### Scenario 4: Transaction Processing

Tests that multi-operation transactions are processed correctly.

- Publishes 50 transactions (each with 5 operations)
- Validates transaction event count
- Checks state consistency (all entities created)

**Expected**: 50 events received, 150 entities in state

## Performance Metrics

The harness tracks:

- **Event counts**: Published vs received
- **Delivery rate**: Events per second
- **Latency**: Time from publish to receive
- **Sequence integrity**: Gaps and duplicates
- **Workspace filtering**: Events by workspace
- **Event type distribution**: Breakdown by type

## Example Workflows

### Test Basic Functionality

```bash
# Run all integrated scenarios
bun run test-harness/scenarios.ts
```

### Load Testing

```bash
# High-rate publishing
bun run test-harness/server.ts --rate 1000 --duration 60000 &
bun run test-harness/client.ts --duration 60000 --verbose
```

### Workspace Isolation Testing

```bash
# Start client for workspace-1
bun run test-harness/client.ts --workspaces workspace-1 --verbose &

# Start client for workspace-2
bun run test-harness/client.ts --workspaces workspace-2 --verbose &

# Publish to both workspaces
bun run test-harness/server.ts --scenario workspace-isolation --duration 30000
```

### Batching Behavior

```bash
# Burst pattern to observe batching
bun run test-harness/server.ts --scenario burst --duration 60000 &
bun run test-harness/client.ts --duration 60000
```

## Understanding the Results

### Client Statistics

When a client finishes, it prints statistics:

```
[Client] === Event Statistics ===
[Client] Total received: 1000
[Client] Duplicates: 0
[Client] Duration: 5432ms
[Client] Rate: 184.16 events/sec

[Client] By event type:
[Client]   EntityCreated: 800
[Client]   Transaction: 200

[Client] By workspace:
[Client]   workspace-1: 500
[Client]   workspace-2: 500
```

### Server Output

The server reports publishing metrics:

```
[Server] Completed: 1000 events in 5234ms
[Server] Effective rate: 191.06 events/sec
```

### Scenario Results

Integrated scenarios show pass/fail status:

```
✓ PASS - Basic Correctness
       Published: 100, Received: 100, Rate: 18.42 events/sec
✓ PASS - Workspace Isolation
       Published: 100, Received: 100, Rate: 19.23 events/sec
```

## Troubleshooting

### Events Not Received

- Check that workspaces match between publisher and subscriber
- Verify entity types are in the subscription filter
- Ensure the client is running before events are published

### Low Throughput

- The system batches events at ~60fps (16ms window)
- Very high rates may trigger backpressure
- Check queue sizes in the StateSync configuration

### Sequence Gaps

- May indicate queue overflow or backpressure
- Increase buffer sizes in configuration
- Reduce publishing rate

## Extending the Harness

### Adding New Scenarios

Edit `scenarios.ts` and add a new scenario function:

```typescript
const scenario5_MyTest = Effect.gen(function* () {
  // Your test logic
  return {
    name: "My Test",
    passed: true,
    publishedCount: 100,
    receivedCount: 100,
    duration: 1000,
    rate: 100,
    errors: [],
  } as TestResult
})
```

Then add it to the main runner:

```typescript
results.push(yield* scenario5_MyTest)
```

### Custom Event Generators

Add to `server.ts`:

```typescript
const generateMyEvent = (): Event => {
  return {
    type: "EntityCreated",
    entityId: EntityId(`my-entity-${counter++}`),
    entityType: "my-type" as EntityType,
    data: { /* your data */ },
  }
}
```

## Architecture Notes

### Batching System

The StateSync system includes automatic event batching:
- Window size: ~16ms (60fps)
- Queue capacity: 10,000 events
- Batched events are merged into the main stream

### Subscription Filtering

Events are filtered based on:
1. **Always include**: Entity types that always pass through
2. **Workspace membership**: Entities belonging to subscribed workspaces
3. **Graph reachability**: Entities connected to workspace subgraphs

### State Management

- State is maintained as a directed graph (entities + edges)
- Events are applied sequentially with atomic transactions
- Subscribers receive filtered event streams
- State snapshots are available via `getState()`

## Next Steps

After validating basic functionality:

1. Add more complex scenarios (e.g., graph traversal, edge updates)
2. Test error conditions (queue overflow, invalid events)
3. Add performance benchmarks with larger datasets
4. Test concurrent publishers and subscribers
5. Measure memory usage under sustained load

---

For more information about the StateSync system, see the main documentation and unit tests in `src/state-sync/`.
