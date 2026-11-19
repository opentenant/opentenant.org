/*
 * Login Embed — no dependencies
 *
 * Expected HTML: /login-form-embed.html
 *
 * Features:
 * - configurable JSON or form-encoded submission
 * - credentials: "include" for secure server-managed auth cookies
 * - optional CSRF header/body value
 * - client-side email/password validation
 * - password visibility toggle
 * - loading, server-error, and success states
 * - project-template picker handoff after successful authentication
 * - server-provided or configured redirect as a fallback
 * - liquid light motion via Web Animations API
 * - reduced-motion support
 *
 * Expected successful JSON response (all fields optional):
 *   { "ok": true, "redirectUrl": "/account" }
 *
 * This script never stores, logs, or persists passwords.
 */
(function () {
  "use strict";
  const supabaseClient = window.supabase.createClient('https://supabase.opentenant.org', "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg4ODAxOTg5LCJleHAiOjE5NDY0ODE5ODl9.cyiirFqv2-YJe5FE8XeHGkDGnZS14dPJmLpqJ42ukrU")
  var SELECTOR = "[data-login-form]";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function initialize() {
    var roots = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < roots.length; i += 1) enhance(roots[i]);
  }

  function enhance(root) {
    if (root.getAttribute("data-login-enhanced") === "true") return;
    root.setAttribute("data-login-enhanced", "true");

    var form = root.querySelector("[data-login-form]");
    var email = root.querySelector("[data-login-email]");
    var submit = root.querySelector("[data-login-submit]");
    var emailError = root.querySelector("[data-login-email-error]");
    var serverError = root.querySelector("[data-login-error]");
    var formView = root.querySelector("[data-login-form-view]");
    var successView = root.querySelector("[data-login-success]");
    var glass = root.querySelector("[data-login-glass]");
    var google = root.querySelector("[data-login-google]");
    var github = root.querySelector("[data-login-github]");
    var busy = false;

    if (!form || !email || !submit) return;

    animateLights(root);
    animateEntry(glass);


    email.addEventListener("input", function () {
      hide(emailError);
      hide(serverError);
      email.style.borderColor = "#ded9e6";
    });

    github.addEventListener("click", async function () {
      console.info('ongithubpress')
      busy = true;
      setLoading(true);
      try {
      await supabaseClient.auth.signOut()
      } catch(err) {}
          const { error } = await supabaseClient.auth.signInWithOAuth({ 
  provider: 'github' ,
        options: {
          redirectTo:"https://opentenant.org/app"
        }
});
        //   .signInWithOAuth({
        //     provider: 'github',
        //   })
    });

    google.addEventListener("click", async function () {
      busy = true;
      setLoading(true);
      try {
      await supabaseClient.auth.signOut()
      } catch(err) {}

        const { error } = await supabaseClient.auth.signInWithOAuth({ 
  provider: 'google',
        options: {
          redirectTo:"https://opentenant.org/app"
        }
});
        // .signInWithOAuth({
        // provider: 'google',
        // })
    });
    
    submit.addEventListener("click", async function (event) {
      event.preventDefault();
      if (busy) return;

      var emailValue = email.value.trim();
      var valid = true;

      hide(emailError);
      hide(serverError);

      if (!isValidEmail(emailValue)) {
        show(emailError);
        email.style.borderColor = "#c53030";
        valid = false;
      }
      if (!valid) {
        shake(form);
        email.focus();
        return;
      }
      busy = true;
      setLoading(true);

        const {
        data: {session},
        error,
        } = await supabaseClient.auth.signInWithOtp({
        email: emailValue,
        options: {
          redirectTo:"https://opentenant.org/app"
        }
        });
        setLoading(false);
        if(error) {
            submitting = false;
            setLoading(false);
            if (fullError) fullError.hidden = false;
            shake(event.currentTarget);
        }
        else {
            showSuccess();
        }
    });

    function setLoading(isLoading) {
      submit.disabled = isLoading;
      submit.style.opacity = isLoading ? "0.74" : "1";
      submit.style.cursor = isLoading ? "wait" : "pointer";
      submit.textContent = isLoading ? "Signing in…" : "Sign in  →";
      email.disabled = isLoading;
      google.disabled = isLoading
      github.disabled = isLoading
    }

    function showSuccess(redirectUrl) {
      setLoading(false);
      formView.hidden = true;
      successView.hidden = false;

      if (!reduceMotion && successView.animate) {
        successView.animate(
          [
            { opacity: 0, transform: "translateY(14px) scale(.94)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          { duration: 560, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" },
        );
      }

      var target = redirectUrl && redirectUrl.indexOf("{{") === -1 ? redirectUrl : "";
      window.dispatchEvent(new CustomEvent("ffmpeglab:login-success", {
        detail: { redirectUrl: target },
      }));

      window.setTimeout(function () {
        if (window.FFmpegLabProjectPopup && window.FFmpegLabProjectPopup.open) {
          window.FFmpegLabProjectPopup.open({ fallbackUrl: target });
          return;
        }
        if (target) window.location.assign(target);
      }, reduceMotion ? 100 : 620);
    }
  }

  function setConfiguredLink(link, value, row) {
    if (!link) return;
    if (!value || value.indexOf("{{") !== -1) {
      link.hidden = true;
      link.style.display = "none";
      link.removeAttribute("href");
      if (row) row.style.display = "none";
    } else {
      link.hidden = false;
      link.style.display = "";
      link.href = value;
      if (row) row.style.display = "";
    }
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function toFormBody(payload) {
    var params = new URLSearchParams();
    Object.keys(payload).forEach(function (key) {
      params.append(key, String(payload[key]));
    });
    return params.toString();
  }

  function show(element) {
    if (element) element.hidden = false;
  }

  function hide(element) {
    if (element) element.hidden = true;
  }

  function animateEntry(element) {
    if (reduceMotion || !element || !element.animate) return;
    element.animate(
      [
        { opacity: 0, transform: "translateY(24px) scale(.97)", filter: "blur(8px)" },
        { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
      ],
      { duration: 760, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" },
    );
  }

  function animateLights(root) {
    if (reduceMotion || !Element.prototype.animate) return;
    var lights = root.querySelectorAll("[data-login-light]");
    for (var i = 0; i < lights.length; i += 1) {
      lights[i].animate(
        [
          { transform: "translate3d(0,0,0) scale(1)" },
          { transform: "translate3d(" + (i % 2 ? -42 : 54) + "px," + (i % 2 ? 38 : -30) + "px,0) scale(1.15)" },
          { transform: "translate3d(0,0,0) scale(1)" },
        ],
        { duration: 9000 + i * 1700, iterations: Infinity, easing: "ease-in-out" },
      );
    }
  }

  function shake(element) {
    if (reduceMotion || !element.animate) return;
    element.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-8px)" },
        { transform: "translateX(8px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 380, easing: "ease-out" },
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
