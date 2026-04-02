import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  IndexTable,
  Badge,
  Modal,
  Select,
  InlineStack,
  EmptyState,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import { Reward } from "../.server/models/reward.model";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const rewards = await Reward.find({ shopId: session.shop })
    .sort({ pointsCost: 1 })
    .lean();

  return json({
    rewards: rewards.map((r) => ({
      id: r._id.toString(),
      name: r.name,
      pointsCost: r.pointsCost,
      discountType: r.discountType,
      discountValue: r.discountValue,
      minimumOrderAmount: r.minimumOrderAmount,
      isActive: r.isActive,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "create": {
      await Reward.create({
        shopId: session.shop,
        name: formData.get("name"),
        pointsCost: Number(formData.get("pointsCost")),
        discountType: formData.get("discountType"),
        discountValue: Number(formData.get("discountValue")),
        minimumOrderAmount: Number(formData.get("minimumOrderAmount")) || 0,
        isActive: true,
      });
      return json({ success: true });
    }

    case "update": {
      await Reward.findByIdAndUpdate(formData.get("id"), {
        name: formData.get("name"),
        pointsCost: Number(formData.get("pointsCost")),
        discountType: formData.get("discountType"),
        discountValue: Number(formData.get("discountValue")),
        minimumOrderAmount: Number(formData.get("minimumOrderAmount")) || 0,
      });
      return json({ success: true });
    }

    case "toggle": {
      const reward = await Reward.findById(formData.get("id"));
      if (reward) {
        reward.isActive = !reward.isActive;
        await reward.save();
      }
      return json({ success: true });
    }

    case "delete": {
      await Reward.findByIdAndDelete(formData.get("id"));
      return json({ success: true });
    }

    default:
      return json({ error: "Invalid intent" }, { status: 400 });
  }
};

export default function RewardsPage() {
  const { rewards } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [modalOpen, setModalOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<typeof rewards[0] | null>(
    null,
  );
  const [form, setForm] = useState({
    name: "",
    pointsCost: "",
    discountType: "FIXED_AMOUNT",
    discountValue: "",
    minimumOrderAmount: "0",
  });

  const openCreate = useCallback(() => {
    setEditingReward(null);
    setForm({
      name: "",
      pointsCost: "",
      discountType: "FIXED_AMOUNT",
      discountValue: "",
      minimumOrderAmount: "0",
    });
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((reward: typeof rewards[0]) => {
    setEditingReward(reward);
    setForm({
      name: reward.name,
      pointsCost: String(reward.pointsCost),
      discountType: reward.discountType,
      discountValue: String(reward.discountValue),
      minimumOrderAmount: String(reward.minimumOrderAmount),
    });
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", editingReward ? "update" : "create");
    if (editingReward) formData.set("id", editingReward.id);
    Object.entries(form).forEach(([k, v]) => formData.set(k, v));
    submit(formData, { method: "post" });
    setModalOpen(false);
  }, [form, editingReward, submit]);

  const handleToggle = useCallback(
    (id: string) => {
      const formData = new FormData();
      formData.set("intent", "toggle");
      formData.set("id", id);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (!confirm("Delete this reward?")) return;
      const formData = new FormData();
      formData.set("intent", "delete");
      formData.set("id", id);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  const resourceName = { singular: "reward", plural: "rewards" };

  const rowMarkup = rewards.map((reward, index) => (
    <IndexTable.Row id={reward.id} key={reward.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" fontWeight="bold">
          {reward.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{reward.pointsCost} pts</IndexTable.Cell>
      <IndexTable.Cell>
        {reward.discountType === "FIXED_AMOUNT"
          ? `₹${reward.discountValue} off`
          : `${reward.discountValue}% off`}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {reward.minimumOrderAmount > 0
          ? `₹${reward.minimumOrderAmount}`
          : "None"}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={reward.isActive ? "success" : "critical"}>
          {reward.isActive ? "Active" : "Inactive"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Button size="slim" onClick={() => openEdit(reward)}>
            Edit
          </Button>
          <Button size="slim" onClick={() => handleToggle(reward.id)}>
            {reward.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button size="slim" tone="critical" onClick={() => handleDelete(reward.id)}>
            Delete
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Reward Tiers"
      primaryAction={{ content: "Create Reward", onAction: openCreate }}
    >
      <Card>
        {rewards.length > 0 ? (
          <IndexTable
            resourceName={resourceName}
            itemCount={rewards.length}
            headings={[
              { title: "Name" },
              { title: "Points Cost" },
              { title: "Discount" },
              { title: "Min Order" },
              { title: "Status" },
              { title: "Actions" },
            ]}
            selectable={false}
          >
            {rowMarkup}
          </IndexTable>
        ) : (
          <EmptyState
            heading="Create your first reward"
            action={{ content: "Create Reward", onAction: openCreate }}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              Set up reward tiers for customers to redeem their loyalty points.
              Since 1 point = ₹1, a reward costing 100 points gives ₹100 in
              value.
            </p>
          </EmptyState>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingReward ? "Edit Reward" : "Create Reward"}
        primaryAction={{
          content: "Save",
          onAction: handleSave,
          loading: isLoading,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Reward Name"
              value={form.name}
              onChange={(v) => setForm((p) => ({ ...p, name: v }))}
              placeholder="e.g., ₹100 Off"
              autoComplete="off"
            />
            <TextField
              label="Points Cost"
              type="number"
              value={form.pointsCost}
              onChange={(v) => setForm((p) => ({ ...p, pointsCost: v }))}
              helpText="How many points to redeem (1 point = ₹1)"
              autoComplete="off"
              min={1}
            />
            <Select
              label="Discount Type"
              options={[
                { label: "Fixed Amount (₹)", value: "FIXED_AMOUNT" },
                { label: "Percentage (%)", value: "PERCENTAGE" },
              ]}
              value={form.discountType}
              onChange={(v) => setForm((p) => ({ ...p, discountType: v }))}
            />
            <TextField
              label={
                form.discountType === "FIXED_AMOUNT"
                  ? "Discount Amount (₹)"
                  : "Discount Percentage (%)"
              }
              type="number"
              value={form.discountValue}
              onChange={(v) => setForm((p) => ({ ...p, discountValue: v }))}
              autoComplete="off"
              min={0.01}
            />
            <TextField
              label="Minimum Order Amount (₹)"
              type="number"
              value={form.minimumOrderAmount}
              onChange={(v) =>
                setForm((p) => ({ ...p, minimumOrderAmount: v }))
              }
              helpText="Set to 0 for no minimum"
              autoComplete="off"
              min={0}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
