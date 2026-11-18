import { expect, test } from "vitest";
import type { HttpInit, HttpResult } from "../../scripts/lib/http.js";
import { cookieHeader, loginWithBotPassword } from "../../scripts/spike/leaguepedia-auth.js";

const PASSWORD = "s3cr3t-pw";

const json = (body: unknown, setCookie: string[] = []): HttpResult => ({
  status: 200,
  headers: {},
  setCookie,
  text: JSON.stringify(body),
});

/** Routes by method: GET returns a login token, POST returns the given login result. */
function fakeHttp(loginResult: string, seen: { init?: HttpInit }[] = []) {
  return async (url: string, init: HttpInit = {}): Promise<HttpResult> => {
    seen.push({ init });
    if ((init.method ?? "GET") === "GET") {
      expect(url).toContain("meta=tokens");
      return json({ query: { tokens: { logintoken: "tok+\\" } } }, ["pre=1; Path=/", "shared=old; Path=/"]);
    }
    return json({ login: { result: loginResult } }, ["session=abc; Path=/; HttpOnly", "shared=new; Path=/"]);
  };
}

test("cookieHeader keeps only name=value pairs", () => {
  expect(cookieHeader(["a=1; Path=/; HttpOnly", "b=2; Secure"])).toBe("a=1; b=2");
});

test("loginWithBotPassword throws when result is not Success", async () => {
  await expect(loginWithBotPassword({ http: fakeHttp("Failed") }, "u", "p")).rejects.toThrow(/Failed/);
});

test("login error never contains the password", async () => {
  const err = await loginWithBotPassword({ http: fakeHttp("Failed") }, "u", PASSWORD).catch((e: Error) => e);
  expect(String((err as Error).message)).not.toContain(PASSWORD);
});

test("login posts a urlencoded form with the token cookies and merges cookies", async () => {
  const seen: { init?: HttpInit }[] = [];
  const cookie = await loginWithBotPassword({ http: fakeHttp("Success", seen) }, "Bot@spike", PASSWORD);

  const post = seen[1]?.init;
  expect(post?.method).toBe("POST");
  expect(post?.headers?.["content-type"]).toBe("application/x-www-form-urlencoded");
  expect(post?.headers?.cookie).toBe("pre=1; shared=old");
  const form = new URLSearchParams(post?.body);
  expect(form.get("action")).toBe("login");
  expect(form.get("lgname")).toBe("Bot@spike");
  expect(form.get("lgpassword")).toBe(PASSWORD);
  expect(form.get("lgtoken")).toBe("tok+\\");
  expect(form.get("format")).toBe("json");

  // Token-response and login-response cookies are merged; later values win.
  expect(cookie).toBe("pre=1; shared=new; session=abc");
});
