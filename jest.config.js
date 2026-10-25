
/** @type {import('jest').Config} */
module.exports = {
    preset: "jest-expo",

    testMatch: ["<rootDir>/__tests__/**/*.test.(ts|tsx)"],

    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/$1",

        // Expo SDK 57: resolver desde la ubicación real del paquete.
        "^expo-modules-core(.*)$":
            "<rootDir>/node_modules/expo/node_modules/expo-modules-core$1"
    },

    collectCoverageFrom: [
        "lib/domain/**/*.ts",
        "lib/services/**/*.ts",
        "store/**/*.ts"
    ]
};
