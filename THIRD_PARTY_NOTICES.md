# Third-party notices

## todometer renderer and assets

Daybridge vendors and adapts the React renderer structure, CSS modules, SVG controls, and visual
assets from [todometer](https://github.com/cassidoo/todometer), an open-source meter-based to-do
list by Cassidy Williams. The former Daybridge-specific card renderer was replaced by this
todometer-based surface; Daybridge now supplies the quest adapter and AIHUB bridge around it.

The upstream project is licensed under the MIT License. Daybridge-specific code includes the quest
adapter, AIHUB reporting boundary, data model, and Tauri shell; the upstream Electron shell and MCP
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
