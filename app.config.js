/**
 * Extiende app.json con valores que NO deben vivir en el repositorio.
 * La clave de Google Maps se lee de GOOGLE_MAPS_ANDROID_API_KEY en tiempo de
 * compilacion (archivo .env local o secreto de EAS). Nunca la escribas aqui.
 */
module.exports = ({ config }) => ({
    ...config,
    android: {
        ...config.android,
        config: {
            ...(config.android?.config ?? {}),
            googleMaps: {
                apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? ""
            }
        }
    }
});
