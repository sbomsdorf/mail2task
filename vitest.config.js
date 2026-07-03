module.exports = {
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    globals: true,
    clearMocks: true,
    restoreMocks: true,
  },
};
