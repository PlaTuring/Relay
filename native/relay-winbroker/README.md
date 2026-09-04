# Relay Win32 broker

This is Relay's first-party x64 Windows helper. It has one closed binary-pipe
entry point (`--capability-profile=path-inspection-v1`) and no shell, network, download, ComfyUI queue,
`/prompt`, inference, or media-generation surface.

The Alpha 27 build implements and runtime-tests the two native operations that
are used as release assurance probes:

- fixed/local NTFS volume inspection;
- handle-based existing-path identity and reparse-point rejection.

Every other opcode in the separately frozen future ABI fails closed with
`RELAY_NATIVE.OPCODE_NOT_ENABLED`.
That is intentional: an unsupported operation is never represented as a
successful capability. The current Relay control plane invokes this helper at
startup to prove the packaged binary is usable and to inspect its local
app-data volume/path. It does not delegate ComfyUI launch or workflow handoff
to this helper.

MiniMax H3 generates video and native audio only after the user clicks Run in
ComfyUI. This helper never runs a model or submits a queue request.
