# Changelog

## [0.8.0](https://github.com/radomir-dev/pollhook/compare/v0.7.0...v0.8.0) (2026-11-26)


### Features

* poll issue dependencies through the REST API ([983a63b](https://github.com/radomir-dev/pollhook/commit/983a63be4009209ace684fbb3c29e4866c899eee))
* poll issue dependencies through the REST API ([9e3dc81](https://github.com/radomir-dev/pollhook/commit/9e3dc81dc055a5b735fe736c0ff621cf5d0e6518))
* poll Projects v2 and project items through the REST API ([117f523](https://github.com/radomir-dev/pollhook/commit/117f5235665de73b04ff712593be5054003bfd36))
* poll Projects v2 and project items through the REST API ([2c7a41c](https://github.com/radomir-dev/pollhook/commit/2c7a41c3c0670002de7a22b47c40cb71d4737e53))


### Bug Fixes

* keep the projects page size in the shared adapter helpers ([88441b2](https://github.com/radomir-dev/pollhook/commit/88441b2a6bc77a2e7e62fa8d5dadd7e02fb2b239))

## [0.7.0](https://github.com/radomir-dev/pollhook/compare/v0.6.0...v0.7.0) (2026-11-26)


### Features

* **site:** add the project site and a demo gif ([3405453](https://github.com/radomir-dev/pollhook/commit/3405453071bb963ab29152d05608d8af7a1596dc))


### Bug Fixes

* report open streams in status and wait for the subscriber in the restart test ([62b72dc](https://github.com/radomir-dev/pollhook/commit/62b72dca43d855233ac0ecb7635255068e6f64ee))

## [0.6.0](https://github.com/radomir-dev/pollhook/compare/v0.5.2...v0.6.0) (2026-11-26)


### Features

* poll discussions and discussion comments through REST ([29c2f1c](https://github.com/radomir-dev/pollhook/commit/29c2f1c3a02ced47e0df0eb9f49d3b47728593c8))

## [0.5.2](https://github.com/radomir-dev/pollhook/compare/v0.5.1...v0.5.2) (2026-11-26)


### Bug Fixes

* **daemon:** a malformed request no longer crashes the daemon ([02c5f68](https://github.com/radomir-dev/pollhook/commit/02c5f68ea6217b37f6777a85bb0b65dc4f6b0fbb))

## [0.5.1](https://github.com/radomir-dev/pollhook/compare/v0.5.0...v0.5.1) (2026-11-26)


### Bug Fixes

* **cli:** init points at status now that the daemon starts itself ([7ab85a0](https://github.com/radomir-dev/pollhook/commit/7ab85a0621393e28d4116ca3450c9f644eb16b0a))

## [0.5.0](https://github.com/radomir-dev/pollhook/compare/v0.4.0...v0.5.0) (2026-11-26)


### Features

* **cli:** start the daemon on demand and add pollhook stop ([a1e6847](https://github.com/radomir-dev/pollhook/commit/a1e6847f3f0de9c25ed5cf259d3f7e4881e054f1))

## [0.4.0](https://github.com/radomir-dev/pollhook/compare/v0.3.1...v0.4.0) (2026-11-26)


### Features

* **cli:** add init and config check, add-repo and remove-repo ([2b59f97](https://github.com/radomir-dev/pollhook/commit/2b59f9749152a944c38937dcb32ccfbbd5a4dca2))
* **cli:** emit reconnects and replays what it missed ([760760d](https://github.com/radomir-dev/pollhook/commit/760760d0800a68abccd97bf0101c24a1cc9881cc))
* **config:** explain a missing config and link the event catalog ([d0fc726](https://github.com/radomir-dev/pollhook/commit/d0fc72619b8dd00df41e2029f0912a3f935061a5))
* **config:** publish a JSON Schema and warn about ignored keys ([a42e821](https://github.com/radomir-dev/pollhook/commit/a42e821b088ccc41ca8b11f7403ba46ea91cd831))
* **poller:** jitter each poll by up to ten percent ([0663b0f](https://github.com/radomir-dev/pollhook/commit/0663b0f49344def5f808f1bd112d0d8f8311e22f))

## [0.3.1](https://github.com/radomir-dev/pollhook/compare/v0.3.0...v0.3.1) (2026-11-25)


### Bug Fixes

* hide the SQLite experimental warning on current Node 22 ([9b79478](https://github.com/radomir-dev/pollhook/commit/9b79478aaf16eab348bef7e5754341e13f310742))
* support Node 22.13 and hide the SQLite experimental warning ([f53d813](https://github.com/radomir-dev/pollhook/commit/f53d813d58d9c59f277747109dd709161fd72e0d))

## [0.3.0](https://github.com/radomir-dev/pollhook/compare/v0.2.0...v0.3.0) (2026-11-25)


### Features

* add org targets and the team event ([b23509b](https://github.com/radomir-dev/pollhook/commit/b23509b59620519472c6afffc4e2d925f62eb282))
* back off degraded adapters for an hour ([3aa7cbb](https://github.com/radomir-dev/pollhook/commit/3aa7cbb57a5496a2880ac38555fdb53fc1ede0ae))
* **cli:** emit --brief prints one line per delivery ([3e8a97b](https://github.com/radomir-dev/pollhook/commit/3e8a97bced2fac2d908672e7822fcce1d968626c))
* **cli:** generate the CLI reference from a command spec ([5a167e5](https://github.com/radomir-dev/pollhook/commit/5a167e5325c061043fcce1930e0294c776ace837))
* **cli:** poke forces an immediate poll round ([893f5d0](https://github.com/radomir-dev/pollhook/commit/893f5d0cbac6bca2f5e5a5f372d4962a9dec2376))
* **config:** per-event intervals and polling strategies ([d0a2cc7](https://github.com/radomir-dev/pollhook/commit/d0a2cc769c06390f380db1b4ee6a3c037cb18d35))
* **daemon:** reload config without dropping consumers ([cb5e33d](https://github.com/radomir-dev/pollhook/commit/cb5e33db69d5624a1990ce1cc5eea05d06edd0de))
* emit advisory and repository security deliveries ([9904907](https://github.com/radomir-dev/pollhook/commit/9904907b193819a032c3b5ebd76f52b602ba1a08))
* emit branch protection configuration changes ([1376bf7](https://github.com/radomir-dev/pollhook/commit/1376bf7706c1ee7dfec5d0496a24bbe87d36c830))
* emit collaborator membership changes ([278acad](https://github.com/radomir-dev/pollhook/commit/278acad7d39eb4decf2a3af412ef3ea2eeb1d25f))
* emit create and delete from ref diffs ([8bf2c55](https://github.com/radomir-dev/pollhook/commit/8bf2c550fb29156fba90c31e014d0aebab5ed912))
* emit dependabot, code scanning and secret scanning alerts ([28e0a6e](https://github.com/radomir-dev/pollhook/commit/28e0a6e19dcf55ca3f314deb14b4d73f9a30a793))
* emit deployment, deploy key and ruleset deliveries ([0afefbd](https://github.com/radomir-dev/pollhook/commit/0afefbd299e87e164058f682d12cd8740fd83543))
* emit issue and issue comment deliveries ([a6f0e9d](https://github.com/radomir-dev/pollhook/commit/a6f0e9d217e754bd6c5793e8905df963d830576e))
* emit release, label and milestone deliveries ([53d36d6](https://github.com/radomir-dev/pollhook/commit/53d36d6037ed35ccf91c224b29f332c4b3c8b6b4))
* emit repository, fork and commit comment deliveries ([f890b71](https://github.com/radomir-dev/pollhook/commit/f890b71108c281927508143647f4bae2bdb3bdc8))
* emit team membership changes ([3c16bfa](https://github.com/radomir-dev/pollhook/commit/3c16bfac4b4b55e7b88343941b775498eea0734a))
* emit workflow dispatch and merge group deliveries ([1489b2f](https://github.com/radomir-dev/pollhook/commit/1489b2f239ec89f9dd3ac461b120478c27d0ff3d))
* key run durations by run id so the first poll backfills them ([9805d37](https://github.com/radomir-dev/pollhook/commit/9805d37cc41a13c672800b097523fd4767287ac2))
* poll deployment protection rules per environment ([d42e264](https://github.com/radomir-dev/pollhook/commit/d42e2642be8c4c08891f8a5c192b7e657bf4bdbd))
* poll GitHub for CI, pull request and Pages events ([3f91563](https://github.com/radomir-dev/pollhook/commit/3f91563dee35b26d22dc7312d5c5853067073831))
* poll GitHub for CI, pull request and Pages events ([11292cc](https://github.com/radomir-dev/pollhook/commit/11292ccdde1be6a6227866e5247fe32d09896d3d))
* poll pending deployments for review requests ([86950df](https://github.com/radomir-dev/pollhook/commit/86950dfdf1bd320d450c46c04cb058c327190a58))
* poll pull request review comments ([d8bb31f](https://github.com/radomir-dev/pollhook/commit/d8bb31f00964eb52716e48e09e63778170c35873))
* poll workflow jobs for active runs ([5d1c61f](https://github.com/radomir-dev/pollhook/commit/5d1c61f552aa89fc4ee8c83d44dbbc8e7e864145))
* prime silently on the first poll of each event ([855bd14](https://github.com/radomir-dev/pollhook/commit/855bd1404bfe74717bd8abac2663020049ea1757))
* reconstruct push deliveries from compare ([e51b0ee](https://github.com/radomir-dev/pollhook/commit/e51b0ee0e518bee5acd95e8cc75ddefc59d8541c))
* report permanent adapter failures as degraded ([5ddefc1](https://github.com/radomir-dev/pollhook/commit/5ddefc10b0859ebb133f88e5ee38056db2ecf57c))
* report the next poll time in status ([c884e01](https://github.com/radomir-dev/pollhook/commit/c884e01c21a6f18af2f515392b80b05ecb80c1c6))
* retry deliveries with exponential backoff ([f488506](https://github.com/radomir-dev/pollhook/commit/f488506b067d58fc245242890c05568185a55798))
* slow polling under rate-limit pressure and honour retry-after ([180a105](https://github.com/radomir-dev/pollhook/commit/180a10534e795d81942cbfa2e4d8df81555fa051))
* track workflow durations and slow polling while runs are early ([dd64c72](https://github.com/radomir-dev/pollhook/commit/dd64c7228644bf70baaae1800c3f46995bf0f340))


### Bug Fixes

* close sockets, bind adapter emits and order snapshot ties ([5ba2136](https://github.com/radomir-dev/pollhook/commit/5ba21365792816fa9e650d834003631924d6d18e))
* prefer the gh login and keep poll round errors ([ca04058](https://github.com/radomir-dev/pollhook/commit/ca0405849a88d898bf5d96713f26a4c42efffbef))
* send the emit subscription so deliveries stream ([475cb38](https://github.com/radomir-dev/pollhook/commit/475cb38a953626975decbe933985a3000971c64b))

## [0.2.0](https://github.com/radomir-dev/pollhook/compare/pollhook-v0.1.0...pollhook-v0.2.0) (2026-11-25)


### Features

* add org targets and the team event ([b23509b](https://github.com/radomir-dev/pollhook/commit/b23509b59620519472c6afffc4e2d925f62eb282))
* back off degraded adapters for an hour ([3aa7cbb](https://github.com/radomir-dev/pollhook/commit/3aa7cbb57a5496a2880ac38555fdb53fc1ede0ae))
* **cli:** emit --brief prints one line per delivery ([3e8a97b](https://github.com/radomir-dev/pollhook/commit/3e8a97bced2fac2d908672e7822fcce1d968626c))
* **cli:** generate the CLI reference from a command spec ([5a167e5](https://github.com/radomir-dev/pollhook/commit/5a167e5325c061043fcce1930e0294c776ace837))
* **cli:** poke forces an immediate poll round ([893f5d0](https://github.com/radomir-dev/pollhook/commit/893f5d0cbac6bca2f5e5a5f372d4962a9dec2376))
* **config:** per-event intervals and polling strategies ([d0a2cc7](https://github.com/radomir-dev/pollhook/commit/d0a2cc769c06390f380db1b4ee6a3c037cb18d35))
* **daemon:** reload config without dropping consumers ([cb5e33d](https://github.com/radomir-dev/pollhook/commit/cb5e33db69d5624a1990ce1cc5eea05d06edd0de))
* emit advisory and repository security deliveries ([9904907](https://github.com/radomir-dev/pollhook/commit/9904907b193819a032c3b5ebd76f52b602ba1a08))
* emit branch protection configuration changes ([1376bf7](https://github.com/radomir-dev/pollhook/commit/1376bf7706c1ee7dfec5d0496a24bbe87d36c830))
* emit collaborator membership changes ([278acad](https://github.com/radomir-dev/pollhook/commit/278acad7d39eb4decf2a3af412ef3ea2eeb1d25f))
* emit create and delete from ref diffs ([8bf2c55](https://github.com/radomir-dev/pollhook/commit/8bf2c550fb29156fba90c31e014d0aebab5ed912))
* emit dependabot, code scanning and secret scanning alerts ([28e0a6e](https://github.com/radomir-dev/pollhook/commit/28e0a6e19dcf55ca3f314deb14b4d73f9a30a793))
* emit deployment, deploy key and ruleset deliveries ([0afefbd](https://github.com/radomir-dev/pollhook/commit/0afefbd299e87e164058f682d12cd8740fd83543))
* emit issue and issue comment deliveries ([a6f0e9d](https://github.com/radomir-dev/pollhook/commit/a6f0e9d217e754bd6c5793e8905df963d830576e))
* emit release, label and milestone deliveries ([53d36d6](https://github.com/radomir-dev/pollhook/commit/53d36d6037ed35ccf91c224b29f332c4b3c8b6b4))
* emit repository, fork and commit comment deliveries ([f890b71](https://github.com/radomir-dev/pollhook/commit/f890b71108c281927508143647f4bae2bdb3bdc8))
* emit team membership changes ([3c16bfa](https://github.com/radomir-dev/pollhook/commit/3c16bfac4b4b55e7b88343941b775498eea0734a))
* emit workflow dispatch and merge group deliveries ([1489b2f](https://github.com/radomir-dev/pollhook/commit/1489b2f239ec89f9dd3ac461b120478c27d0ff3d))
* key run durations by run id so the first poll backfills them ([9805d37](https://github.com/radomir-dev/pollhook/commit/9805d37cc41a13c672800b097523fd4767287ac2))
* poll deployment protection rules per environment ([d42e264](https://github.com/radomir-dev/pollhook/commit/d42e2642be8c4c08891f8a5c192b7e657bf4bdbd))
* poll GitHub for CI, pull request and Pages events ([3f91563](https://github.com/radomir-dev/pollhook/commit/3f91563dee35b26d22dc7312d5c5853067073831))
* poll GitHub for CI, pull request and Pages events ([11292cc](https://github.com/radomir-dev/pollhook/commit/11292ccdde1be6a6227866e5247fe32d09896d3d))
* poll pending deployments for review requests ([86950df](https://github.com/radomir-dev/pollhook/commit/86950dfdf1bd320d450c46c04cb058c327190a58))
* poll pull request review comments ([d8bb31f](https://github.com/radomir-dev/pollhook/commit/d8bb31f00964eb52716e48e09e63778170c35873))
* poll workflow jobs for active runs ([5d1c61f](https://github.com/radomir-dev/pollhook/commit/5d1c61f552aa89fc4ee8c83d44dbbc8e7e864145))
* prime silently on the first poll of each event ([855bd14](https://github.com/radomir-dev/pollhook/commit/855bd1404bfe74717bd8abac2663020049ea1757))
* reconstruct push deliveries from compare ([e51b0ee](https://github.com/radomir-dev/pollhook/commit/e51b0ee0e518bee5acd95e8cc75ddefc59d8541c))
* report permanent adapter failures as degraded ([5ddefc1](https://github.com/radomir-dev/pollhook/commit/5ddefc10b0859ebb133f88e5ee38056db2ecf57c))
* report the next poll time in status ([c884e01](https://github.com/radomir-dev/pollhook/commit/c884e01c21a6f18af2f515392b80b05ecb80c1c6))
* retry deliveries with exponential backoff ([f488506](https://github.com/radomir-dev/pollhook/commit/f488506b067d58fc245242890c05568185a55798))
* slow polling under rate-limit pressure and honour retry-after ([180a105](https://github.com/radomir-dev/pollhook/commit/180a10534e795d81942cbfa2e4d8df81555fa051))
* track workflow durations and slow polling while runs are early ([dd64c72](https://github.com/radomir-dev/pollhook/commit/dd64c7228644bf70baaae1800c3f46995bf0f340))


### Bug Fixes

* close sockets, bind adapter emits and order snapshot ties ([5ba2136](https://github.com/radomir-dev/pollhook/commit/5ba21365792816fa9e650d834003631924d6d18e))
* prefer the gh login and keep poll round errors ([ca04058](https://github.com/radomir-dev/pollhook/commit/ca0405849a88d898bf5d96713f26a4c42efffbef))
* send the emit subscription so deliveries stream ([475cb38](https://github.com/radomir-dev/pollhook/commit/475cb38a953626975decbe933985a3000971c64b))
