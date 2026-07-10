class OfflineGroundedProvider {
  id() {
    return "offline-grounded-contract";
  }

  async callApi(prompt) {
    return {
      output: `${prompt}\n\n离线契约答案 [E1]`,
      metadata: {
        retrieval_mode: "bm25",
        source: "raw/offline-fixture.md#line:1",
      },
    };
  }
}

module.exports = OfflineGroundedProvider;
