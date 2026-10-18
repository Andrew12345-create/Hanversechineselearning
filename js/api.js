javascript
/* ==========================================
   HANVERSE API
   Central API Helper
   Version 1.0
========================================== */

/* ==========================================
   API BASE URL
========================================== */

export const API_BASE =
    window.location.hostname === "localhost"
        ? "/.netlify/functions/server"
        : "/api";

/* ==========================================
   API REQUEST
========================================== */

export async function api(
    endpoint,
    {
        method = "GET",
        body = null,
        headers = {},
        timeout = 30000
    } = {}
) {

    const controller = new AbortController();

    const timer = setTimeout(() => {
        controller.abort();
    }, timeout);

    try { 

        const response = await fetch(
            `${API_BASE}${endpoint}`,
            {
                method,

                headers: {
                    "Content-Type": "application/json",
                    ...headers
                },

                body,

                signal: controller.signal
            }
        );

        clearTimeout(timer);

        let data;

        const contentType =
            response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {

            data = await response.json();

        } else {

            const text = await response.text();

            data = {
                success: false,
                error: text || `HTTP ${response.status}`
            };

        }

        return {
            ok: response.ok,
            status: response.status,
            data,
            response
        };

    } catch (error) {

        clearTimeout(timer);

        if (error.name === "AbortError") {

            return {
                ok: false,
                status: 408,
                data: {
                    success: false,
                    error: "Request timed out."
                }
            };

        }

        return {
            ok: false,
            status: 500,
            data: {
                success: false,
                error: error.message || "Network error."
            }
        };

    }

}

/* ==========================================
   GET
========================================== */

export async function get(endpoint) {

    return api(endpoint);

}

/* ==========================================
   POST
========================================== */

export async function post(endpoint, payload = {}) {

    return api(endpoint, {

        method: "POST",

        body: JSON.stringify(payload)

    });

}

/* ==========================================
   PUT
========================================== */

export async function put(endpoint, payload = {}) {

    return api(endpoint, {

        method: "PUT",

        body: JSON.stringify(payload)

    });

}

/* ==========================================
   DELETE
========================================== */

export async function del(endpoint) {

    return api(endpoint, {

        method: "DELETE"

    });

}

/* ==========================================
   FILE UPLOAD
========================================== */

export async function upload(endpoint, formData) {

    try {

        const response = await fetch(
            `${API_BASE}${endpoint}`,
            {
                method: "POST",
                body: formData
            }
        );

        const data = await response.json();

        return {

            ok: response.ok,

            status: response.status,

            data

        };

    } catch (error) {

        return {

            ok: false,

            status: 500,

            data: {

                success: false,

                error: error.message

            }

        };

    }

}

/* ==========================================
   USER SESSION
========================================== */

export const SESSION_KEY = "hanverse_user";

export function saveUser(user) {

    localStorage.setItem(
        SESSION_KEY,
        JSON.stringify(user)
    );

}

export function getUser() {

    const user =
        localStorage.getItem(SESSION_KEY);

    if (!user) return null;

    try {

        return JSON.parse(user);

    } catch {

        return null;

    }

}

export function removeUser() {

    localStorage.removeItem(SESSION_KEY);

}

export function isLoggedIn() {

    return !!getUser();

}

/* ==========================================
   LOGOUT
========================================== */

export function logout() {

    removeUser();

    window.location.href = "login.html";

}

/* ==========================================
   DEBUG
========================================== */

console.log(
    "HanVerse API:",
    API_BASE
);