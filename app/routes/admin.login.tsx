import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import {
  AppProvider,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useState } from "react";
import {
  createAdminSession,
  getAdminCredentials,
  isAdminAuthenticated,
} from "../.server/admin-auth.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await isAdminAuthenticated(request)) {
    const url = new URL(request.url);
    throw redirect(url.searchParams.get("redirectTo") || "/admin");
  }

  return json({
    polarisTranslations,
    usesDefaultPassword: !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const username = String(formData.get("username") || "");
  const password = String(formData.get("password") || "");
  const redirectTo = String(formData.get("redirectTo") || "/admin");
  const credentials = getAdminCredentials();

  if (
    username === credentials.username &&
    password === credentials.password &&
    redirectTo.startsWith("/")
  ) {
    return createAdminSession(redirectTo);
  }

  return json({ error: "Invalid username or password" }, { status: 401 });
};

export default function AdminLogin() {
  const { polarisTranslations, usesDefaultPassword } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page narrowWidth title="Admin login">
        <Box paddingBlockStart="800">
          <Card>
            <Form method="post">
              <input
                type="hidden"
                name="redirectTo"
                value={searchParams.get("redirectTo") || "/admin"}
              />
              <FormLayout>
                <BlockStack gap="200">
                  <Text as="h1" variant="headingLg">
                    Login to admin panel
                  </Text>
                  <Text as="p" tone="subdued">
                    Separate access for managing app health and plugins.
                  </Text>
                </BlockStack>

                {usesDefaultPassword && (
                  <Banner tone="warning">
                    <p>
                      Default login is admin / admin123. Set ADMIN_USERNAME and
                      ADMIN_PASSWORD in env before production.
                    </p>
                  </Banner>
                )}

                {actionData?.error && (
                  <Banner tone="critical">
                    <p>{actionData.error}</p>
                  </Banner>
                )}

                <TextField
                  label="Username"
                  name="username"
                  value={username}
                  onChange={setUsername}
                  autoComplete="username"
                />
                <TextField
                  label="Password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                />
                <Button
                  submit
                  variant="primary"
                  loading={navigation.state === "submitting"}
                >
                  Log in
                </Button>
              </FormLayout>
            </Form>
          </Card>
        </Box>
      </Page>
    </AppProvider>
  );
}
