module.exports = {
   verbose: true,
   resetMocks: true,
   restoreMocks: true,
   testEnvironment: "node",
   testMatch: ['<rootDir>/test/**/*.[jt]s?(x)'],
   testPathIgnorePatterns: ['/__.+__/'],
   moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/src/$1',
   },
   coverageThreshold: {
      global: {
         lines: 100,
         functions: 100,
         branches: 90,
         statements: 1,
      },
   },
};
