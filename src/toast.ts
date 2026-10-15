let timer: ReturnType<typeof setTimeout> | undefined;
export function clearToast() {
  clearTimeout(timer);
  document.querySelector(".toast")?.remove();
}
export function toast(message: string, error = false) {
  clearToast();
  const el = document.createElement("div");
  el.className = `toast ${error ? "error" : ""}`;
  el.setAttribute("role", error ? "alert" : "status");
  el.textContent = message;
  document.body.append(el);
  // Typing mistakes need brief feedback; other errors retain their reading time.
  const passwordError = /passwords? (?:is |was )?(?:incorrect|invalid|wrong)|(?:incorrect|invalid|wrong) password|passwords? do not match|invalid password/i.test(message);
  timer = setTimeout(() => el.remove(), error ? (passwordError ? 3000 : 12000) : 4500);
}
