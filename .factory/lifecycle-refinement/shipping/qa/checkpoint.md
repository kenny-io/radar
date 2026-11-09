# Shipping QA checkpoint

Read-only pre-deploy audit complete. This does not approve a live/all-emails claim.

- PR25 was open/mergeable at ebd34ae840b538adf80910a8af3a8e27143978aa; PM then integrated main at 9b40b8a2a05495be663b36b9570af22986efdd8a.
- Integrated source fingerprint: 6b306cdbe23ff549130e05c078773aeb0730164cb9130c17fc7dae4f1a1b8a15, 641 files. Earlier lifecycle evidence is reused only for unchanged scope.
- Incoming operator-email/publishing overlap: 44/44 independent tests passed, mocked transport. Command and output in main-merge-focused.log.
- Actual isolated live Chrome: health200 and signin200; pending-release forgot-password/email-preferences404, unauthenticated Settings→signup. Zero writes/page errors. Exact production revision is unknown from public health. live-public.json records UTC observation time and results.
- Inventory covers 30 permanent slots, #5 retired, 29 preview families/72 variants. #28 is a separate unmerged feature, not an accepted production trigger.

Pending/blocked: PM-hosted migration and worker/config/deployment identity evidence; new integrated #28 implementation/acceptance; owner-controlled authenticated test account and coordinated receipt mailbox. No production mutation, message, charge or activation performed. Tests do not establish inbox arrival. See plan.md for the post-deploy acceptance gates and inventory.md for the numbered trigger map.
