# Third-Party Licenses and Notices

This project (`mkmv`) bundles or distributes third-party software, fonts, and runtime libraries. This document provides copyright and licensing information for these components.

---

## 1. Noto Sans CJK KR (Font)

* **Component**: `template/fonts/NotoSansCJKkr-Regular.otf`
* **Copyright**:
  * Copyright (c) 2014-2021 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'.
  * Copyright (c) 2014-2021 Google Inc. (https://fonts.google.com/), with Reserved Font Name 'Noto'.
* **License**: SIL Open Font License, Version 1.1 (OFL-1.1)
* **Upstream**: https://github.com/googlefonts/noto-cjk
* **License Text**: See [`template/fonts/OFL.txt`](template/fonts/OFL.txt) or Section 5 below.

---

## 2. Bundled Shared Libraries (`template/lib/`)

The pre-compiled ARM64 (`aarch64-linux-gnu`) shared libraries bundled in `template/lib/` are extracted from standard Linux distribution packages (Debian GNU/Linux and Ubuntu) to provide a self-contained runtime environment on PortMaster handheld devices.

These libraries remain covered by their original respective open-source licenses. In accordance with these licenses, users may replace or upgrade any dynamically linked library (`.so`) with compatible binaries.

### A. GNU Lesser General Public License (LGPL v2.1 / LGPL v2.0 / LGPL v3.0)

The following libraries are licensed under the GNU Lesser General Public License:
* **GTK+ 3** (`libgtk-3.so.0*`, `libgdk-3.so.0*`) - LGPL-2.1+ (https://gitlab.gnome.org/GNOME/gtk)
* **Pango** (`libpango-1.0.so.0*`, `libpangocairo-1.0.so.0*`, `libpangoft2-1.0.so.0*`) - LGPL-2.0+ (https://gitlab.gnome.org/GNOME/pango)
* **Cairo** (`libcairo.so.2*`, `libcairo-gobject.so.2*`) - LGPL-2.1 or MPL-1.1 (https://gitlab.freedesktop.org/cairo/cairo)
* **ATK / AT-SPI** (`libatk-1.0.so.0*`, `libatk-bridge-2.0.so.0*`, `libatspi.so.0*`) - LGPL-2.0+ / LGPL-2.1+ (https://gitlab.gnome.org/GNOME/atk)
* **libsecret** (`libsecret-1.so.0*`) - LGPL-2.1+ (https://gitlab.gnome.org/GNOME/libsecret)
* **libspeechd (Speech Dispatcher)** (`libspeechd.so.2*`) - LGPL-2.1+ (https://github.com/brailcom/speechd)
* **Avahi Client & Common** (`libavahi-client.so.3*`, `libavahi-common.so.3*`) - LGPL-2.1+ (https://github.com/avahi/avahi)
* **libudev (systemd/eudev)** (`libudev.so.1*`) - LGPL-2.1+ (https://github.com/eudev-project/eudev)
* **libnotify** (`libnotify.so.4*`) - LGPL-2.1+ (https://gitlab.gnome.org/GNOME/libnotify)

**Source Code Availability**:
The source code for these LGPL libraries can be obtained from their official upstream repositories linked above, or from Debian/Ubuntu package archives:
```bash
apt-get source <package-name>
```

### B. Mozilla Public License (MPL 2.0)

* **NSS & NSPR** (`libnss3.so`, `libnssutil3.so`, `libsmime3.so`, `libssl3.so`, `libnspr4.so`, `libplc4.so`, `libplds4.so`, `libsoftokn3.so`, `libfreebl3.so`, `libfreeblpriv3.so`)
* **License**: MPL 2.0 (https://www.mozilla.org/MPL/2.0/)
* **Upstream Source**: https://hg.mozilla.org/projects/nss

### C. MIT / BSD / Apache / Zlib / Other Permissive Licenses

* **Wayland & Wayland-EGL** (`libwayland-*.so*`): MIT License (https://gitlab.freedesktop.org/wayland/wayland)
* **XCB & X11 Client Libraries** (`libxcb*.so*`, `libX11*.so*`, `libXext.so*`, `libXrandr.so*`, `libXrender.so*`, `libXi.so*`, `libXtst.so*`, `libXdamage.so*`, `libXfixes.so*`, `libXcomposite.so*`, `libXcursor.so*`, `libXinerama.so*`): MIT / X11 License (https://gitlab.freedesktop.org/xorg)
* **libxkbcommon** (`libxkbcommon*.so*`): MIT/X11 License (https://github.com/xkbcommon/libxkbcommon)
* **libdrm** (`libdrm.so*`): MIT License (https://gitlab.freedesktop.org/mesa/drm)
* **libepoxy** (`libepoxy.so*`): MIT License (https://github.com/anholt/libepoxy)
* **libgbm / libglapi** (`libgbm.so*`, `libglapi.so*`): MIT License (Mesa Project - https://gitlab.freedesktop.org/mesa/mesa)
* **libpng** (`libpng16.so.16*`): libpng License (http://www.libpng.org/pub/png/src/libpng-LICENSE.txt)
* **libjpeg** (`libjpeg.so.8*`): IJG License (https://ijg.org/)
* **libffi** (`libffi.so.8*`): MIT License (https://github.com/libffi/libffi)
* **libcups** (`libcups.so.2`): Apache License 2.0 with GPL2 Exception (https://github.com/OpenPrinting/cups)
* **libbsd / libmd** (`libbsd.so.0*`, `libmd.so.0*`): BSD 3-Clause / BSD 2-Clause Licenses
* **Kerberos / krb5** (`libkrb5*.so*`, `libgssapi_krb5.so*`, `libk5crypto.so*`, `libcom_err.so*`): MIT / Kerberos License (https://web.mit.edu/kerberos/)
* **libfribidi** (`libfribidi.so.0*`): LGPL-2.1+ (https://github.com/fribidi/fribidi)
* **libdatrie / libthai** (`libdatrie.so.1*`, `libthai.so.0*`): LGPL-2.1+ (https://linux.thai.net/)

---

## 3. Electron Runtime & Chromium

* **Component**: Electron Linux ARM64 runtime (`v22.3.27`) downloaded during build
* **Copyright**:
  * Copyright (c) Electron contributors
  * Copyright (c) 2013-2020 GitHub Inc.
* **License**: MIT License
* **Chromium Components**: Various BSD, MIT, and LGPL licenses. Detailed license disclosures are provided in `LICENSES.chromium.html` bundled within the Electron distribution.

---

## 4. Node.js Build Dependencies

* **adm-zip**: MIT License (Copyright (c) 2012-2024 Various Contributors, https://github.com/cthackers/adm-zip)

---

## 5. SIL Open Font License Version 1.1

```
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide development
of collaborative font projects, to support the font creation efforts of academic
and linguistic communities, and to provide a free and open framework in which fonts
may be shared and improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and redistributed
freely as long as they are not sold by themselves. The fonts, including any
derivative works, can be bundled, embedded, redistributed and/or sold with any
software provided that any reserved names are not used by derivative works. The
fonts and derivatives, however, cannot be released under any other type of license.
The requirement for fonts to remain under this license does not apply to any document
created using the fonts or their derivatives.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a copy of the
Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell
modified and unmodified copies of the Font Software, subject to the following
conditions:

1) Neither the Font Software nor any of its individual components, in Original or
Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled, redistributed
and/or sold with any software, provided that each copy contains the above copyright
notice and this license. These can be included either as stand-alone text files,
human-readable headers or in the appropriate machine-readable metadata fields within
text or binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font Name(s) unless
prominent written permission is granted by the corresponding Copyright Holder. This
restriction only applies to the primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software shall
not be used to promote, endorse or advertise any Modified Version, except to acknowledge
the contribution(s) of the Copyright Holder(s) and the Author(s) or with their explicit
written permission.

5) The Font Software, modified or unmodified, in part or in whole, must be distributed
entirely under this license, and must not be distributed under any other license.
The requirement for fonts to remain under this license does not apply to any document
created using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR
OTHER RIGHT. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR
CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS
IN THE FONT SOFTWARE.
```
