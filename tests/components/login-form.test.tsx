import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import React from "react";

import {
  clickElement,
  findByTextContains,
  setInputValue,
  setupDom,
} from "../helpers/dom";

const modulePath = "@/components/auth/login-form";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  const handle = setupDom();
  cleanup = handle.cleanup;
});

afterEach(() => {
  mock.restoreAll();
  cleanup?.();
  cleanup = undefined;
});

async function renderLoginForm(search = "") {
  const push = mock.fn();
  const refresh = mock.fn();

  mock.module("next/navigation", () => ({
    useRouter: () => ({ push, refresh }),
    useSearchParams: () => new URLSearchParams(search),
  }));

  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container as unknown as Element);
  const { LoginForm } = await import(modulePath);

  await act(async () => {
    root.render(React.createElement(LoginForm));
  });

  return { container, root, push, refresh, fetchMock } as const;
}

test("submits credentials and redirects to the requested page", async () => {
  const { container, push, refresh, fetchMock } = await renderLoginForm("next=/storage");

  const usernameInput = document.querySelector("input#username");
  const passwordInput = document.querySelector("input#password");
  const submitButton = findByTextContains(document.body as any, "Sign in");
  assert.ok(usernameInput && passwordInput && submitButton, "form elements should exist");

  setInputValue(usernameInput as any, "admin");
  setInputValue(passwordInput as any, "secret");

  await act(async () => {
    clickElement(submitButton as any);
    await Promise.resolve();
  });

  assert.equal(fetchMock.mock.callCount(), 1, "should invoke fetch");
  assert.equal(push.mock.callCount(), 1, "should navigate after login");
  assert.equal(push.mock.calls[0].arguments[0], "/storage");
  assert.equal(refresh.mock.callCount(), 1, "should refresh router after login");

  container.remove();
});

test("shows validation errors for invalid credentials", async () => {
  const push = mock.fn();
  const refresh = mock.fn();

  mock.module("next/navigation", () => ({
    useRouter: () => ({ push, refresh }),
    useSearchParams: () => new URLSearchParams(),
  }));

  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "invalid_credentials" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  );

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const { LoginForm } = await import(modulePath);

  await act(async () => {
    root.render(React.createElement(LoginForm));
  });

  const usernameInput = document.querySelector("input#username");
  const passwordInput = document.querySelector("input#password");
  const submitButton = findByTextContains(document.body as any, "Sign in");
  assert.ok(usernameInput && passwordInput && submitButton);

  setInputValue(usernameInput as any, "operator");
  setInputValue(passwordInput as any, "wrong");

  await act(async () => {
    clickElement(submitButton as any);
    await Promise.resolve();
  });

  assert.equal(fetchMock.mock.callCount(), 1, "should send credentials");
  assert.equal(push.mock.callCount(), 0, "should not navigate on failure");

  const error = findByTextContains(document.body as any, "The provided credentials are incorrect");
  assert.ok(error, "should surface invalid credential warning");

  container.remove();
});

test("indicates when credentials are missing", async () => {
  const push = mock.fn();
  const refresh = mock.fn();

  mock.module("next/navigation", () => ({
    useRouter: () => ({ push, refresh }),
    useSearchParams: () => new URLSearchParams(),
  }));

  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "missing_credentials" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }),
  );

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const { LoginForm } = await import(modulePath);

  await act(async () => {
    root.render(React.createElement(LoginForm));
  });

  const usernameInput = document.querySelector("input#username");
  const passwordInput = document.querySelector("input#password");
  const submitButton = findByTextContains(document.body as any, "Sign in");
  assert.ok(usernameInput && passwordInput && submitButton);

  setInputValue(usernameInput as any, "   ");
  setInputValue(passwordInput as any, "   ");

  await act(async () => {
    clickElement(submitButton as any);
    await Promise.resolve();
  });

  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(push.mock.callCount(), 0);

  const error = findByTextContains(document.body as any, "Please provide both a username and password");
  assert.ok(error, "should surface missing credential warning");

  container.remove();
});
