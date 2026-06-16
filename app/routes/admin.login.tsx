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
  Button,
  FormLayout,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useState } from "react";
import {
  authenticateAdminUser,
  createAdminSession,
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
  const admin = await authenticateAdminUser(username, password);

  if (admin && redirectTo.startsWith("/")) {
    return createAdminSession(admin, redirectTo);
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
      <style>
        {`
          body {
            background: #f4f7fb;
          }

          html,
          body {
            width: 100%;
            overflow-x: hidden;
          }

          .admin-login-page {
            min-height: 100vh;
            min-height: 100dvh;
            display: grid;
            place-items: center;
            padding: 32px 20px;
            color: #111827;
          }

          .admin-login-shell {
            width: min(980px, 100%);
            display: grid;
            grid-template-columns: minmax(280px, 0.9fr) minmax(340px, 1.1fr);
            border: 1px solid #dce5ee;
            border-radius: 18px;
            overflow: hidden;
            background: #ffffff;
            box-shadow: 0 24px 70px rgba(15, 23, 42, 0.12);
          }

          .admin-login-brand {
            min-height: 560px;
            padding: 34px;
            background: #102033;
            color: #ffffff;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }

          .admin-login-logo {
            width: 48px;
            height: 48px;
            border-radius: 12px;
            background: #2ed3b7;
            color: #0b1220;
            display: grid;
            place-items: center;
            font-weight: 800;
            letter-spacing: 0;
          }

          .admin-login-brand h1 {
            font-size: 32px;
            line-height: 1.15;
            margin: 0;
            letter-spacing: 0;
          }

          .admin-login-brand p {
            color: #c8d5e3;
            font-size: 15px;
            line-height: 1.6;
            margin: 12px 0 0;
          }

          .admin-login-pills {
            display: grid;
            gap: 10px;
          }

          .admin-login-pill {
            display: flex;
            align-items: center;
            gap: 10px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 10px;
            padding: 11px 12px;
            background: rgba(255, 255, 255, 0.06);
            color: #e8eef6;
            font-size: 13px;
            font-weight: 650;
          }

          .admin-login-pill span {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: #2ed3b7;
            flex: 0 0 auto;
          }

          .admin-login-form {
            padding: 46px;
            display: flex;
            align-items: center;
          }

          .admin-login-form-inner {
            width: 100%;
          }

          .admin-login-eyebrow {
            color: #0f62fe;
            font-size: 12px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0;
            margin: 0 0 10px;
          }

          .admin-login-title {
            margin: 0 0 8px;
            font-size: 28px;
            line-height: 1.2;
            color: #111827;
            letter-spacing: 0;
          }

          .admin-login-copy {
            margin: 0;
            color: #5c6675;
            line-height: 1.55;
          }

          .admin-login-alerts {
            margin: 22px 0;
          }

          .admin-login-submit {
            margin-top: 4px;
          }

          .admin-login-footer {
            margin-top: 18px;
            color: #6b7280;
            font-size: 12px;
            line-height: 1.5;
          }

          @media (max-width: 860px) {
            .admin-login-page {
              padding: 20px 14px;
              align-items: start;
            }

            .admin-login-shell {
              grid-template-columns: 1fr;
              max-width: 620px;
              border-radius: 16px;
            }

            .admin-login-brand {
              min-height: auto;
              gap: 22px;
              padding: 28px;
            }

            .admin-login-form {
              padding: 30px 24px;
            }

            .admin-login-brand h1 {
              font-size: 28px;
            }
          }

          @media (max-width: 520px) {
            .admin-login-page {
              display: block;
              padding: 0;
              background: #ffffff;
            }

            .admin-login-shell {
              min-height: 100vh;
              min-height: 100dvh;
              width: 100%;
              border: 0;
              border-radius: 0;
              box-shadow: none;
            }

            .admin-login-brand {
              padding: 22px 20px 18px;
              gap: 16px;
              border-radius: 0 0 22px 22px;
            }

            .admin-login-logo {
              width: 42px;
              height: 42px;
              border-radius: 11px;
            }

            .admin-login-brand h1 {
              font-size: 23px;
              line-height: 1.18;
            }

            .admin-login-brand p {
              font-size: 14px;
              line-height: 1.5;
              margin-top: 8px;
            }

            .admin-login-pills {
              grid-template-columns: 1fr;
              gap: 8px;
            }

            .admin-login-pill {
              min-height: 40px;
              padding: 9px 10px;
              font-size: 12px;
            }

            .admin-login-form {
              padding: 26px 20px 32px;
              align-items: start;
            }

            .admin-login-title {
              font-size: 25px;
            }

            .admin-login-copy {
              font-size: 14px;
            }

            .admin-login-alerts {
              margin: 18px 0;
            }

            .admin-login-submit {
              margin-top: 8px;
            }

            .admin-login-form .Polaris-TextField__Input {
              min-height: 46px;
              font-size: 16px;
            }
          }

          @media (max-width: 380px) {
            .admin-login-brand {
              padding: 18px 16px 16px;
            }

            .admin-login-form {
              padding: 22px 16px 28px;
            }

            .admin-login-brand h1 {
              font-size: 21px;
            }

            .admin-login-title {
              font-size: 23px;
            }
          }
        `}
      </style>
      <main className="admin-login-page">
        <section className="admin-login-shell" aria-label="Admin login">
          <aside className="admin-login-brand">
            <BlockStack gap="500">
              <div className="admin-login-logo">LR</div>
              <div>
                <h1>Control every store from one secure panel.</h1>
                <p>
                  Manage plugins, store health, billing, audit logs, sync jobs,
                  and storefront configuration from a separate admin surface.
                </p>
              </div>
            </BlockStack>

            <div className="admin-login-pills">
              <div className="admin-login-pill">
                <span />
                Multi-store tenant isolation
              </div>
              <div className="admin-login-pill">
                <span />
                Role-based admin access
              </div>
              <div className="admin-login-pill">
                <span />
                Plugin and sync control plane
              </div>
            </div>
          </aside>

          <section className="admin-login-form">
            <div className="admin-login-form-inner">
              <Form method="post">
                <input
                  type="hidden"
                  name="redirectTo"
                  value={searchParams.get("redirectTo") || "/admin"}
                />
                <FormLayout>
                  <div>
                    <p className="admin-login-eyebrow">Admin panel</p>
                    <h2 className="admin-login-title">Welcome back</h2>
                    <p className="admin-login-copy">
                      Sign in with your internal admin credentials.
                    </p>
                  </div>

                  <div className="admin-login-alerts">
                    <BlockStack gap="300">
                      {usesDefaultPassword && (
                        <Banner tone="warning">
                          <p>
                            Default login is admin / admin123. Set
                            ADMIN_USERNAME and ADMIN_PASSWORD in env before
                            production.
                          </p>
                        </Banner>
                      )}

                      {actionData?.error && (
                        <Banner tone="critical">
                          <p>{actionData.error}</p>
                        </Banner>
                      )}
                    </BlockStack>
                  </div>

                  <TextField
                    label="Username"
                    name="username"
                    value={username}
                    onChange={setUsername}
                    autoComplete="username"
                    placeholder="admin"
                  />
                  <TextField
                    label="Password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                    placeholder="Enter password"
                  />
                  <div className="admin-login-submit">
                    <Button
                      submit
                      variant="primary"
                      size="large"
                      fullWidth
                      loading={navigation.state === "submitting"}
                    >
                      Log in
                    </Button>
                  </div>

                  <Text as="p" tone="subdued">
                    Access is separate from Shopify merchant login.
                  </Text>
                </FormLayout>
              </Form>
            </div>
          </section>
        </section>
      </main>
    </AppProvider>
  );
}
