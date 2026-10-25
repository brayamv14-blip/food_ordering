/**
 * Configuracion de Sentry orientada a NO recopilar datos personales
 * (telefonos, direcciones, correo, IP). Se separa de app/_layout.tsx para poder
 * probar el filtrado sin inicializar Sentry.
 */

const PHONE_LIKE = /\+?\d[\d\s().-]{8,}\d/g;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/g;

/** Enmascara telefonos y correos que aparezcan dentro de un texto. */
export function redactText(text: string): string {
    return text.replace(EMAIL_LIKE, "[correo]").replace(PHONE_LIKE, "[telefono]");
}

type AnyEvent = {
    user?: unknown;
    request?: unknown;
    contexts?: Record<string, unknown>;
    exception?: { values?: { value?: string }[] };
    message?: string;
    breadcrumbs?: { category?: string; message?: string; data?: unknown }[];
    extra?: unknown;
};

/**
 * Limpia un evento antes de enviarlo: sin usuario, sin request, sin `extra`,
 * sin migas de consola (suelen contener objetos con datos del pedido) y con
 * telefonos/correos enmascarados en mensajes.
 */
export function scrubEvent<T extends AnyEvent>(event: T): T {
    delete event.user;
    delete event.request;
    delete event.extra;
    if (event.message) event.message = redactText(event.message);
    event.exception?.values?.forEach((v) => {
        if (v.value) v.value = redactText(v.value);
    });
    if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs
            .filter((b) => b.category !== "console")
            .map((b) => ({
                ...b,
                message: b.message ? redactText(b.message) : b.message,
                data: undefined
            }));
    }
    return event;
}

export const sentryPrivacyOptions = {
    sendDefaultPii: false,
    // Sin grabacion de sesiones; solo una fraccion de errores, con todo enmascarado.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    maskAllText: true,
    maskAllImages: true,
    maskAllVectors: true
} as const;
