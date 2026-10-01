# Third-party notices

## Packaged bridge runtime

The bridge packaging command uses Node.js v24.19.0 for Windows x64 and rolldown
1.2.1. Node's unmodified license text is retained in
`scripts/packaging/node-v24.19.0-LICENSE.txt`, from the tagged upstream
[Node.js license](https://github.com/nodejs/node/blob/v24.19.0/LICENSE).
Its SHA-256 is checked before packaging.

Each runtime includes `THIRD_PARTY_NOTICES.txt` with this attribution, the complete Node notices
and the license/notice files of the npm packages included in the bridge bundle,
including googleapis 170.0.0. The generated `runtime-manifest.json` records
dependency versions and SHA-256 hashes of the runtime files. Packaging fails
when an included dependency has no available license text; the MIT license of
data-uri-to-buffer 4.0.1 is included from its upstream package README.

The build tool is a development dependency and is not shipped as part of the
runtime. No environment files, OAuth material, user data or complete
`node_modules` tree are copied into the runtime.

## todometer renderer and assets

Daybridge vendors and adapts the React renderer structure, CSS modules, SVG controls, and visual
assets from [todometer](https://github.com/cassidoo/todometer), an open-source meter-based to-do
list by Cassidy Williams. The former Daybridge-specific card renderer was replaced by this
todometer-based surface; Daybridge now supplies the quest adapter and MARU bridge around it.

The upstream project is licensed under the MIT License. Daybridge-specific code includes the quest
adapter, MARU reporting boundary, data model, and Tauri shell; the upstream Electron shell and MCP
server are not copied.

Copyright (c) 2026 Cassidy Williams

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
