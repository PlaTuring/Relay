#ifndef MINIMAXH3_WINBROKER_ABI_H_
#define MINIMAXH3_WINBROKER_ABI_H_

/*
 * P1-NAT-001 protocol constants only. This header declares no DLL exports,
 * callable functions, implementation source, or generic command surface.
 * Multi-byte integer fields are little-endian on the private pipe.
 */

#include <stdint.h>

#define MINIMAXH3_WINBROKER_ABI_VERSION_MAJOR 1u
#define MINIMAXH3_WINBROKER_ABI_VERSION_MINOR 0u
#define MINIMAXH3_WINBROKER_ABI_VERSION_PATCH 0u
#define MINIMAXH3_WINBROKER_ABI_MANIFEST_SHA256 "sha256:9ec29a44e4fa3292c6e77cce98a104fe4e6f36aa56d173b64d1ff00f490fa085"

#define MINIMAXH3_WINBROKER_CONTROL_MAGIC_U32 0x5733484du
#define MINIMAXH3_WINBROKER_CONTROL_HEADER_BYTES 32u
#define MINIMAXH3_WINBROKER_CONTROL_FRAMING_VERSION 1u
#define MINIMAXH3_WINBROKER_CONTROL_MAX_PAYLOAD_BYTES 262144u

#define MINIMAXH3_WINBROKER_STREAM_MAGIC_U32 0x5333484du
#define MINIMAXH3_WINBROKER_STREAM_HEADER_BYTES 40u
#define MINIMAXH3_WINBROKER_STREAM_FRAMING_VERSION 1u
#define MINIMAXH3_WINBROKER_STREAM_MAX_CHUNK_BYTES 1048576u
#define MINIMAXH3_WINBROKER_STREAM_MAX_TOTAL_BYTES UINT64_C(274877906944)
#define MINIMAXH3_WINBROKER_STREAM_FLAG_FINAL 0x00000001u

typedef uint16_t minimaxh3_winbroker_message_kind_t;
#define MINIMAXH3_WINBROKER_MESSAGE_CLIENT_HELLO ((minimaxh3_winbroker_message_kind_t)1u)
#define MINIMAXH3_WINBROKER_MESSAGE_SERVER_HELLO ((minimaxh3_winbroker_message_kind_t)2u)
#define MINIMAXH3_WINBROKER_MESSAGE_REQUEST ((minimaxh3_winbroker_message_kind_t)3u)
#define MINIMAXH3_WINBROKER_MESSAGE_RESPONSE ((minimaxh3_winbroker_message_kind_t)4u)
#define MINIMAXH3_WINBROKER_MESSAGE_CANCEL_REQUEST ((minimaxh3_winbroker_message_kind_t)5u)
#define MINIMAXH3_WINBROKER_MESSAGE_CANCEL_RESULT ((minimaxh3_winbroker_message_kind_t)6u)
#define MINIMAXH3_WINBROKER_MESSAGE_CLOSE ((minimaxh3_winbroker_message_kind_t)7u)

typedef uint16_t minimaxh3_winbroker_opcode_t;
#define MINIMAXH3_WINBROKER_OPCODE_INSPECT_VOLUME_CANDIDATE ((minimaxh3_winbroker_opcode_t)0x0101u)
#define MINIMAXH3_WINBROKER_OPCODE_VALIDATE_PATH_IDENTITY ((minimaxh3_winbroker_opcode_t)0x0102u)
#define MINIMAXH3_WINBROKER_OPCODE_PREPARE_OWNED_ROOT ((minimaxh3_winbroker_opcode_t)0x0103u)
#define MINIMAXH3_WINBROKER_OPCODE_MATERIALIZE_OWNED_ARTIFACT ((minimaxh3_winbroker_opcode_t)0x0201u)
#define MINIMAXH3_WINBROKER_OPCODE_COMMIT_OWNED_STATE ((minimaxh3_winbroker_opcode_t)0x0202u)
#define MINIMAXH3_WINBROKER_OPCODE_LAUNCH_MANAGED_CORE ((minimaxh3_winbroker_opcode_t)0x0301u)
#define MINIMAXH3_WINBROKER_OPCODE_VERIFY_LOOPBACK_OWNER ((minimaxh3_winbroker_opcode_t)0x0302u)
#define MINIMAXH3_WINBROKER_OPCODE_QUERY_OR_STOP_OWNED_LAUNCH ((minimaxh3_winbroker_opcode_t)0x0303u)
#define MINIMAXH3_WINBROKER_OPERATION_FAMILY_COUNT 8u

typedef uint32_t minimaxh3_winbroker_error_t;
#define MINIMAXH3_WINBROKER_ERROR_OK ((minimaxh3_winbroker_error_t)0u)
#define MINIMAXH3_WINBROKER_ERROR_BAD_MAGIC ((minimaxh3_winbroker_error_t)1001u)
#define MINIMAXH3_WINBROKER_ERROR_UNSUPPORTED_FRAME_VERSION ((minimaxh3_winbroker_error_t)1002u)
#define MINIMAXH3_WINBROKER_ERROR_INVALID_HEADER ((minimaxh3_winbroker_error_t)1003u)
#define MINIMAXH3_WINBROKER_ERROR_FRAME_TOO_LARGE ((minimaxh3_winbroker_error_t)1004u)
#define MINIMAXH3_WINBROKER_ERROR_FRAME_TRUNCATED ((minimaxh3_winbroker_error_t)1005u)
#define MINIMAXH3_WINBROKER_ERROR_INVALID_UTF8 ((minimaxh3_winbroker_error_t)1006u)
#define MINIMAXH3_WINBROKER_ERROR_NON_CANONICAL_JSON ((minimaxh3_winbroker_error_t)1007u)
#define MINIMAXH3_WINBROKER_ERROR_DUPLICATE_KEY ((minimaxh3_winbroker_error_t)1008u)
#define MINIMAXH3_WINBROKER_ERROR_UNKNOWN_FIELD ((minimaxh3_winbroker_error_t)1009u)
#define MINIMAXH3_WINBROKER_ERROR_UNSUPPORTED_ABI_VERSION ((minimaxh3_winbroker_error_t)1010u)
#define MINIMAXH3_WINBROKER_ERROR_UNEXPECTED_FRAME_KIND ((minimaxh3_winbroker_error_t)1011u)
#define MINIMAXH3_WINBROKER_ERROR_UNKNOWN_OPCODE ((minimaxh3_winbroker_error_t)1012u)
#define MINIMAXH3_WINBROKER_ERROR_REPLAY_DETECTED ((minimaxh3_winbroker_error_t)1014u)
#define MINIMAXH3_WINBROKER_ERROR_FORBIDDEN_SURFACE ((minimaxh3_winbroker_error_t)1019u)
#define MINIMAXH3_WINBROKER_ERROR_PARENT_IDENTITY_MISMATCH ((minimaxh3_winbroker_error_t)2001u)
#define MINIMAXH3_WINBROKER_ERROR_SIGNING_STATE_MISMATCH ((minimaxh3_winbroker_error_t)2008u)
#define MINIMAXH3_WINBROKER_ERROR_TIMEOUT ((minimaxh3_winbroker_error_t)3001u)
#define MINIMAXH3_WINBROKER_ERROR_CANCELLED ((minimaxh3_winbroker_error_t)3002u)
#define MINIMAXH3_WINBROKER_ERROR_CANCEL_TOO_LATE ((minimaxh3_winbroker_error_t)3003u)

#pragma pack(push, 1)
typedef struct minimaxh3_winbroker_control_frame_header_v1 {
  uint8_t magic[4];
  uint16_t header_size_le;
  uint16_t framing_version_le;
  uint32_t payload_length_le;
  uint16_t message_kind_le;
  uint16_t opcode_le;
  uint32_t flags_le;
  uint64_t sequence_le;
  uint32_t reserved_le;
} minimaxh3_winbroker_control_frame_header_v1;

typedef struct minimaxh3_winbroker_stream_frame_header_v1 {
  uint8_t magic[4];
  uint16_t header_size_le;
  uint16_t framing_version_le;
  uint32_t chunk_length_le;
  uint32_t flags_le;
  uint8_t stream_id[16];
  uint32_t chunk_sequence_le;
  uint32_t reserved_le;
} minimaxh3_winbroker_stream_frame_header_v1;
#pragma pack(pop)

#if defined(__cplusplus)
static_assert(sizeof(minimaxh3_winbroker_control_frame_header_v1) == 32u, "control frame ABI drift");
static_assert(sizeof(minimaxh3_winbroker_stream_frame_header_v1) == 40u, "stream frame ABI drift");
#elif defined(_MSC_VER)
_Static_assert(sizeof(minimaxh3_winbroker_control_frame_header_v1) == 32u, "control frame ABI drift");
_Static_assert(sizeof(minimaxh3_winbroker_stream_frame_header_v1) == 40u, "stream frame ABI drift");
#endif

#endif /* MINIMAXH3_WINBROKER_ABI_H_ */
