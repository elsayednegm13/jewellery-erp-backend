"use strict";

const { REFERENCES, MID_DATE_2 } = require("../config");

module.exports = {
  name: "10-manual-journal-cycle",
  description: "Execute a manual journal cycle (create draft, post, reverse)",
  run: async (client, context) => {
    // 1. Create manual draft
    // POST /api/v1/journal-entries/manual-draft
    const draftPayload = {
      description: "قيد تسوية مصروفات تشغيلية يدوي بذور",
      date: MID_DATE_2,
      lines: [
        { accountId: "ACC-6000", debit: 5000, credit: 0, description: "تسوية مصروفات تشغيلية" },
        { accountId: "ACC-1110", debit: 0, credit: 5000, description: "تسوية من الصندوق" }
      ]
    };

    const res1 = await client.request("POST", "/api/v1/journal-entries/manual-draft", draftPayload);
    if (res1.status !== 201) {
      throw new Error(`Create Manual Journal Draft failed with status ${res1.status}: ${JSON.stringify(res1.data)}`);
    }

    const journalId = res1.data.data.id;
    context.results.JOURNAL_ID = journalId;

    // 2. Post manual draft
    // POST /api/v1/journal-entries/:id/post
    const res2 = await client.request("POST", `/api/v1/journal-entries/${journalId}/post`);
    if (res2.status !== 200) {
      throw new Error(`Post Manual Journal failed with status ${res2.status}: ${JSON.stringify(res2.data)}`);
    }

    // 3. Reverse posted manual journal
    // POST /api/v1/journal-entries/:id/reverse
    const res3 = await client.request("POST", `/api/v1/journal-entries/${journalId}/reverse`);
    if (res3.status !== 201) {
      throw new Error(`Reverse Manual Journal failed with status ${res3.status}: ${JSON.stringify(res3.data)}`);
    }

    context.results.JOURNAL_REVERSAL_ID = res3.data.data.id;
  }
};
