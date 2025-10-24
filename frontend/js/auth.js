// ...existing code...
const API_BASE = "https://5rylnhcn8k.execute-api.us-east-1.amazonaws.com";

function el(id){return document.getElementById(id);}

document.addEventListener("DOMContentLoaded", () => {
  const showLogin = el("show-login");
  const showRegister = el("show-register");
  const loginSeg = el("login-segment");
  const regSeg = el("register-segment");
  const msg = el("message");

  // redirect if already authenticated
  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role");
  if (token && role) {
    if (role === "admin") location.href = "admin.html";
    else if (role === "staff") location.href = "staff.html";
    else location.href = "user.html";
  }

  showLogin.addEventListener("click", () => {
    showLogin.classList.add("active");
    showRegister.classList.remove("active");
    loginSeg.classList.remove("hidden");
    regSeg.classList.add("hidden");
  });

  showRegister.addEventListener("click", () => {
    showRegister.classList.add("active");
    showLogin.classList.remove("active");
    regSeg.classList.remove("hidden");
    loginSeg.classList.add("hidden");
  });

  el("login-button").addEventListener("click", async () => {
    msg.textContent = "";
    const email = el("login-email").value.trim();
    const password = el("login-password").value;
    if (!email || !password) { msg.textContent = "Fill email and password"; return; }
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(()=>({}));
      if (res.ok && data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("role", data.role || "user");
        if (data.role === "admin") location.href = "admin.html";
        else if (data.role === "staff") location.href = "staff.html";
        else location.href = "user.html";
      } else {
        msg.textContent = data.error || "Login failed";
      }
    } catch (e) {
      msg.textContent = "Network error";
      console.error(e);
    }
  });

  el("register-button").addEventListener("click", async () => {
    msg.textContent = "";
    const name = el("register-name").value.trim();
    const email = el("register-email").value.trim();
    const password = el("register-password").value;
    if (!name || !email || !password) { msg.textContent = "Fill all fields"; return; }
    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
      });
      const data = await res.json().catch(()=>({}));
      if (res.ok) {
        msg.textContent = "Registered. Please login.";
        showLogin.click();
      } else {
        msg.textContent = data.error || "Registration failed";
      }
    } catch (e) {
      msg.textContent = "Network error";
      console.error(e);
    }
  });
});
// ...existing code...