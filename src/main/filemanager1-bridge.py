#!/usr/bin/env python3
"""
org.freedesktop.FileManager1 DBus bridge for Max File Manager.

Allows Firefox, Chrome, VS Code, and other FreeDesktop applications to open
folders or show downloaded files in Max File Manager via the standard
org.freedesktop.FileManager1 DBus interface.
"""

import sys
import os
import subprocess
from urllib.parse import urlparse, unquote

try:
    import gi
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio, GLib
except ImportError:
    sys.exit(1)

INTERFACE_XML = """
<node>
  <interface name="org.freedesktop.FileManager1">
    <method name="ShowFolders">
      <arg type="as" name="URIs" direction="in"/>
      <arg type="s" name="StartupId" direction="in"/>
    </method>
    <method name="ShowItems">
      <arg type="as" name="URIs" direction="in"/>
      <arg type="s" name="StartupId" direction="in"/>
    </method>
    <method name="ShowItemProperties">
      <arg type="as" name="URIs" direction="in"/>
      <arg type="s" name="StartupId" direction="in"/>
    </method>
  </interface>
</node>
"""

def uri_to_path(uri: str) -> str:
    if uri.startswith('file://'):
        return unquote(urlparse(uri).path)
    return uri

def find_launcher():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, '..', '..'))
    electron_bin = os.path.join(repo_root, 'node_modules', '.bin', 'electron')
    if os.path.exists(electron_bin) and os.path.exists(os.path.join(repo_root, 'package.json')):
        return [electron_bin, repo_root]
    return ["max-file-manager"]

def open_paths(uris):
    launcher = find_launcher()
    for uri in uris:
        p = uri_to_path(uri)
        if not p:
            continue
        try:
            cmd = launcher + [p]
            subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True
            )
        except Exception as e:
            sys.stderr.write(f"Error launching max-file-manager: {e}\n")

class FileManager1Service:
    def __init__(self):
        self.node_info = Gio.DBusNodeInfo.new_for_xml(INTERFACE_XML)
        self.owner_id = Gio.bus_own_name(
            Gio.BusType.SESSION,
            "org.freedesktop.FileManager1",
            Gio.BusNameOwnerFlags.REPLACE,
            self.on_bus_acquired,
            self.on_name_acquired,
            self.on_name_lost
        )

    def on_bus_acquired(self, conn, name):
        self.conn = conn
        conn.register_object(
            "/org/freedesktop/FileManager1",
            self.node_info.interfaces[0],
            self.handle_method_call,
            None,
            None
        )

    def on_name_acquired(self, conn, name):
        pass

    def on_name_lost(self, conn, name):
        pass

    def handle_method_call(self, conn, sender, object_path, interface_name, method_name, parameters, invocation):
        uris, startup_id = parameters.unpack()
        open_paths(uris)
        invocation.return_value(None)

def main():
    service = FileManager1Service()
    loop = GLib.MainLoop()
    try:
        loop.run()
    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    main()
