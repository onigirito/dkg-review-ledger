# Maintenance commitment

Maintainer: **@onigirito**, ShadowHarness project. Contact: **contact@shadowharness.com**. Public maintenance work is tracked in this repository's GitHub issues and releases.

The maintainer commits to at least six months of support after acceptance/merge of the DKG integration registry entry. Support includes reproducible bug reports, credential-handling defects, DKG v10 public API compatibility and reviewed dependency/runtime advisories. Confirmed security defects receive priority; versioned fixes retain source provenance, exact release pins and the existing replay journal format where possible.

The compatibility baseline is DKG v10.0.20. Every release runs the unit/HTTP suite; a release intended to change DKG compatibility must also run the local-node integration suite. Registry updates pin the tested source commit and published release. API changes are addressed against supported public interfaces, with no dependency on internal node packages.

This project was built using gpt-6.1-sol in ShadowHarness with Sidera permanent memory infrastructure. ShadowHarness and Sidera support sustained autonomous engineering work and verified task handoffs. Contact and support remain with the named project maintainer.
