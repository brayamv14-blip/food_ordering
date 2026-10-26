/** @type {import('jest').Config} */
module.exports = {
    preset: "jest-expo",
    testMatch: ["<rootDir>/__tests__/**/*.test.(ts|tsx)"],
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/$1",
        // expo-modules-core queda anidado dentro de expo (SDK 57) y jest-expo
        // lo busca en la raiz; se apunta explicitamente sin agregar otra dependencia.
        "^expo-modules-core(.*)$": "<rootDir>/node_modules/expo/node_modules/expo-modules-core$1"
    },
    collectCoverageFrom: [
        "lib/domain/**/*.ts",
        "lib/services/**/*.ts",
        "store/**/*.ts"
    ]
};
