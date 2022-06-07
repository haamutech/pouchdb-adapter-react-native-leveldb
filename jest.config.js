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
};
