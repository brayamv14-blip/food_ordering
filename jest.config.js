
/** @type {import('jest').Config} */
module.exports = {
    preset: "jest-expo",
    // El primer render de cada pantalla puede superar los 5 segundos.
    testTimeout: 30000,
    testMatch: ["<rootDir>/__tests__/**/*.test.(ts|tsx)"],
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/$1"
    },
    collectCoverageFrom: [
        "lib/domain/**/*.ts",
        "lib/services/**/*.ts",
        "store/**/*.ts"
    ]
};
