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
  Checkbox,
  InlineGrid,
  Divider,
  Banner,
  InlineStack,
  Badge,
  Select,
  ButtonGroup,
} from "@shopify/polaris";
import { useState, useCallback, useMemo } from "react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../db.server";
import {
  getOrCreateSizeGuideSettings,
  SizeGuideSettings,
} from "../.server/models/size-guide-settings.model";

type UnitKey = "cm" | "in";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const settings = await getOrCreateSizeGuideSettings(session.shop);
  return json({ settings: JSON.parse(JSON.stringify(settings)) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const formData = await request.formData();
  const data = Object.fromEntries(formData);

  try {
    const parseMatrix = (raw: unknown): string[][] =>
      JSON.parse(String(raw || "[]")).map((row: unknown) =>
        Array.isArray(row) ? row.map((c) => String(c ?? "")) : [],
      );
    const parseList = (raw: unknown): string[] =>
      JSON.parse(String(raw || "[]")).map((c: unknown) => String(c ?? ""));

    await SizeGuideSettings.findOneAndUpdate(
      { shopId: session.shop },
      {
        $set: {
          enabled: data.enabled === "true",
          triggerLabel: String(data.triggerLabel || "Size Chart"),
          showIcon: data.showIcon === "true",
          modalTitle: String(data.modalTitle || "Size Charts"),
          chartTitle: String(data.chartTitle || ""),
          note: String(data.note || ""),
          headersCm: parseList(data.headersCm),
          rowsCm: parseMatrix(data.rowsCm),
          headersInches: parseList(data.headersInches),
          rowsInches: parseMatrix(data.rowsInches),
          accentColor: String(data.accentColor || "#d97706"),
          textColor: String(data.textColor || "#1f2937"),
          rowAltColor: String(data.rowAltColor || "#fafafa"),
          borderColor: String(data.borderColor || "#e5e7eb"),
        },
      },
      { upsert: true },
    );

    return json({ success: true });
  } catch (error) {
    return json({ success: false, error: "Failed to save" }, { status: 500 });
  }
};

export default function SizeGuideSettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";

  const [enabled, setEnabled] = useState<boolean>(settings.enabled);
  const [triggerLabel, setTriggerLabel] = useState<string>(settings.triggerLabel);
  const [showIcon, setShowIcon] = useState<boolean>(settings.showIcon);
  const [modalTitle, setModalTitle] = useState<string>(settings.modalTitle);
  const [chartTitle, setChartTitle] = useState<string>(settings.chartTitle);
  const [note, setNote] = useState<string>(settings.note || "");

  const [accentColor, setAccentColor] = useState<string>(settings.accentColor);
  const [textColor, setTextColor] = useState<string>(settings.textColor);
  const [rowAltColor, setRowAltColor] = useState<string>(settings.rowAltColor);
  const [borderColor, setBorderColor] = useState<string>(settings.borderColor);

  const [activeUnit, setActiveUnit] = useState<UnitKey>("cm");
  const [headersCm, setHeadersCm] = useState<string[]>(settings.headersCm || []);
  const [rowsCm, setRowsCm] = useState<string[][]>(settings.rowsCm || []);
  const [headersInches, setHeadersInches] = useState<string[]>(settings.headersInches || []);
  const [rowsInches, setRowsInches] = useState<string[][]>(settings.rowsInches || []);

  const headers = activeUnit === "cm" ? headersCm : headersInches;
  const setHeaders = activeUnit === "cm" ? setHeadersCm : setHeadersInches;
  const rows = activeUnit === "cm" ? rowsCm : rowsInches;
  const setRows = activeUnit === "cm" ? setRowsCm : setRowsInches;

  const colCount = useMemo(() => headers.length, [headers]);

  const updateHeader = (i: number, value: string) => {
    const next = [...headers];
    next[i] = value;
    setHeaders(next);
  };

  const addColumn = () => {
    setHeaders([...headers, `Col ${headers.length + 1}`]);
    setRows(rows.map((r) => [...r, ""]));
  };

  const removeColumn = (i: number) => {
    if (headers.length <= 1) return;
    setHeaders(headers.filter((_, idx) => idx !== i));
    setRows(rows.map((r) => r.filter((_, idx) => idx !== i)));
  };

  const updateCell = (rowIdx: number, colIdx: number, value: string) => {
    const next = rows.map((r) => [...r]);
    next[rowIdx][colIdx] = value;
    setRows(next);
  };

  const addRow = () => {
    setRows([...rows, new Array(colCount).fill("")]);
  };

  const removeRow = (i: number) => {
    setRows(rows.filter((_, idx) => idx !== i));
  };

  const copyCmToInches = useCallback(() => {
    setHeadersInches([...headersCm]);
    setRowsInches(rowsCm.map((r) => [...r]));
  }, [headersCm, rowsCm]);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("enabled", String(enabled));
    formData.set("triggerLabel", triggerLabel);
    formData.set("showIcon", String(showIcon));
    formData.set("modalTitle", modalTitle);
    formData.set("chartTitle", chartTitle);
    formData.set("note", note);
    formData.set("headersCm", JSON.stringify(headersCm));
    formData.set("rowsCm", JSON.stringify(rowsCm));
    formData.set("headersInches", JSON.stringify(headersInches));
    formData.set("rowsInches", JSON.stringify(rowsInches));
    formData.set("accentColor", accentColor);
    formData.set("textColor", textColor);
    formData.set("rowAltColor", rowAltColor);
    formData.set("borderColor", borderColor);
    submit(formData, { method: "post" });
  }, [
    enabled, triggerLabel, showIcon, modalTitle, chartTitle, note,
    headersCm, rowsCm, headersInches, rowsInches,
    accentColor, textColor, rowAltColor, borderColor, submit,
  ]);

  return (
    <Page
      title="Size Guide"
      primaryAction={{ content: "Save", onAction: handleSave, loading: isLoading }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        <Layout>
          <Layout.AnnotatedSection
            title="Status"
            description="Enable or disable the size guide on product pages."
          >
            <Card>
              <BlockStack gap="300">
                <Checkbox
                  label="Enable Size Guide"
                  checked={enabled}
                  onChange={setEnabled}
                />
                {enabled && <Badge tone="success">Active on storefront</Badge>}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Trigger Button"
            description="The 'Size Chart' link that opens the modal on the product page."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Trigger Label"
                  value={triggerLabel}
                  onChange={setTriggerLabel}
                  autoComplete="off"
                />
                <Checkbox
                  label="Show ruler icon"
                  checked={showIcon}
                  onChange={setShowIcon}
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Modal Content"
            description="Header, chart title, and footer note shown inside the popup."
          >
            <Card>
              <BlockStack gap="400">
                <TextField
                  label="Modal Header"
                  value={modalTitle}
                  onChange={setModalTitle}
                  autoComplete="off"
                />
                <TextField
                  label="Chart Title"
                  value={chartTitle}
                  onChange={setChartTitle}
                  autoComplete="off"
                />
                <TextField
                  label="Footer Note"
                  value={note}
                  onChange={setNote}
                  multiline={2}
                  autoComplete="off"
                />
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Size Chart"
            description="Edit columns and rows for CM and INCHES tabs. The first column (e.g. age group) is emphasized as the row label."
          >
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="300" align="space-between" blockAlign="center">
                  <ButtonGroup variant="segmented">
                    <Button
                      pressed={activeUnit === "cm"}
                      onClick={() => setActiveUnit("cm")}
                    >
                      CM
                    </Button>
                    <Button
                      pressed={activeUnit === "in"}
                      onClick={() => setActiveUnit("in")}
                    >
                      INCHES
                    </Button>
                  </ButtonGroup>
                  {activeUnit === "in" && (
                    <Button onClick={copyCmToInches} variant="plain">
                      Copy from CM
                    </Button>
                  )}
                </InlineStack>

                <Divider />

                <Text as="h3" variant="headingSm">Columns</Text>
                <BlockStack gap="200">
                  {headers.map((h, i) => (
                    <InlineStack key={`h-${i}`} gap="100" blockAlign="center" wrap={false}>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label={`Column ${i + 1}`}
                          labelHidden
                          value={h}
                          onChange={(v) => updateHeader(i, v)}
                          autoComplete="off"
                        />
                      </div>
                      <Button
                        tone="critical"
                        variant="tertiary"
                        onClick={() => removeColumn(i)}
                        disabled={headers.length <= 1}
                        accessibilityLabel={`Remove column ${i + 1}`}
                      >
                        ✕
                      </Button>
                    </InlineStack>
                  ))}
                </BlockStack>
                <InlineStack>
                  <Button onClick={addColumn}>+ Add column</Button>
                </InlineStack>

                <Divider />

                <Text as="h3" variant="headingSm">Rows</Text>
                <BlockStack gap="200">
                  {rows.map((row, rIdx) => (
                    <InlineStack key={`r-${rIdx}`} gap="100" blockAlign="center" wrap={false}>
                      {Array.from({ length: colCount }).map((_, cIdx) => (
                        <div key={`r-${rIdx}-c-${cIdx}`} style={{ flex: 1, minWidth: 80 }}>
                          <TextField
                            label={headers[cIdx] || `Col ${cIdx + 1}`}
                            labelHidden
                            placeholder={headers[cIdx] || `Col ${cIdx + 1}`}
                            value={row[cIdx] ?? ""}
                            onChange={(v) => updateCell(rIdx, cIdx, v)}
                            autoComplete="off"
                          />
                        </div>
                      ))}
                      <Button
                        tone="critical"
                        variant="tertiary"
                        onClick={() => removeRow(rIdx)}
                        accessibilityLabel={`Remove row ${rIdx + 1}`}
                      >
                        ✕
                      </Button>
                    </InlineStack>
                  ))}
                </BlockStack>
                <InlineStack>
                  <Button onClick={addRow}>+ Add row</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Appearance"
            description="Colors used for the trigger link, table text, rows, and borders."
          >
            <Card>
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <TextField label="Accent" value={accentColor} onChange={setAccentColor} autoComplete="off" />
                <TextField label="Text" value={textColor} onChange={setTextColor} autoComplete="off" />
                <TextField label="Alternate Row" value={rowAltColor} onChange={setRowAltColor} autoComplete="off" />
                <TextField label="Border" value={borderColor} onChange={setBorderColor} autoComplete="off" />
              </InlineGrid>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>

        <Banner tone="info">
          <p>
            After enabling, add the <strong>Size Guide</strong> block to your
            product template in the Theme Editor (Online Store → Themes → Customize
            → Product page → Add block → Apps).
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
