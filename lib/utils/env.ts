export function isMockMode() {
  return process.env.MOCK_MODE !== "false";
}

export function providerOrMock(value: string | undefined) {
  return value && value.trim().length > 0 ? value : "mock";
}
