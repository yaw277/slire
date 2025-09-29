// Jest global teardown
module.exports = async () => {
  if (global.__EMULATOR_CLEANUP__) {
    await global.__EMULATOR_CLEANUP__();
  }
};
