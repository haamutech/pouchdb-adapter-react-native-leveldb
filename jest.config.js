module.exports = {
   verbose: true,
   resetMocks: true,
   restoreMocks: true,
   testMatch: ['<rootDir>/test/**/*.[jt]s?(x)'],
   testPathIgnorePatterns: ['/__mocks__/'],
   moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/src/$1',
   },
};
