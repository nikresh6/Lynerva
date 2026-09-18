const baseUrl =
  process.env.BETTER_AUTH_URL ??
  process.env.LYNERVA_SMOKE_BASE_URL ??
  "http://localhost:3000";

const email = `ci-auth-${Date.now()}@example.com`;
const password = "ci-test-password-12345";

function cookieHeader(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values = headers.getSetCookie?.() ?? [
    response.headers.get("set-cookie") ?? "",
  ];

  return values
    .filter(Boolean)
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function bodyText(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function main() {
  const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: JSON.stringify({
      name: "CI Auth",
      email,
      password,
      callbackURL: "/tracker",
    }),
  });

  const signupBody = await bodyText(signup);
  if (!signup.ok) {
    throw new Error(
      `Auth sign-up failed (${signup.status}): ${signupBody.slice(0, 1200)}`,
    );
  }

  const cookies = cookieHeader(signup);
  if (!cookies) {
    throw new Error("Auth sign-up succeeded but no session cookie was returned.");
  }

  const session = await fetch(`${baseUrl}/api/auth/get-session`, {
    headers: {
      cookie: cookies,
      origin: baseUrl,
    },
  });
  const sessionBody = await bodyText(session);

  if (!session.ok) {
    throw new Error(
      `Auth session check failed (${session.status}): ${sessionBody.slice(0, 1200)}`,
    );
  }

  const payload = JSON.parse(sessionBody) as {
    user?: { email?: string };
  } | null;

  if (payload?.user?.email !== email) {
    throw new Error(
      `Auth session did not resolve the created user: ${sessionBody.slice(0, 1200)}`,
    );
  }

  console.log("Auth sign-up and session smoke test passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
