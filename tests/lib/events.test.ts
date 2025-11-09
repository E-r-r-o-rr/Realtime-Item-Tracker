import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

afterEach(() => {
  mock.restoreAll();
});

describe("events module", () => {
  it("broadcasts storage create and update events through the active consumer", async () => {
    const modulePath = `@/lib/events?case-${Date.now()}`;
    const events: any[] = [];
    const { publishStorageCreated, publishStorageUpdated, setEventConsumer } = await import(modulePath);

    setEventConsumer(async (event) => {
      events.push(event);
    });

    await publishStorageCreated({
      trackingId: "ABC123",
      destination: "R1-A",
      itemName: "Widget",
    });

    await publishStorageUpdated(
      {
        trackingId: "ABC123",
        destination: "R1-B",
        itemName: "Widget",
        booked: 1,
      },
      { destination: "R1-B", booked: 1 },
    );

    assert.equal(events.length, 2);
    assert.equal(events[0]?.type, "storage.created");
    assert.equal(events[1]?.type, "storage.updated");
    assert.deepEqual(events[1]?.changes, { destination: "R1-B", booked: 1 });
    assert.equal(events[0]?.payload.trackingId, "ABC123");
  });

  it("resets to the default logging consumer when resetEventConsumer is called", async () => {
    const modulePath = `@/lib/events?reset-${Date.now()}`;
    const { publishStorageCreated, setEventConsumer, resetEventConsumer } = await import(modulePath);

    const info = mock.method(console, "info", mock.fn());

    setEventConsumer(() => {});
    resetEventConsumer();

    await publishStorageCreated({
      trackingId: "XYZ789",
      destination: "R2-C",
      itemName: "Crate",
    });

    assert.equal(info.mock.callCount(), 1);
    const [message, payload] = info.mock.calls[0]!.arguments;
    assert.match(message as string, /storage.created/);
    assert.equal((payload as any).payload.trackingId, "XYZ789");
  });
});
