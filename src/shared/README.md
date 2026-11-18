# Shared

Code used by both the main process and the renderer, such as the types and
constants for the messages they exchange. Nothing here may import Electron,
Node or React, since both sides load it.
