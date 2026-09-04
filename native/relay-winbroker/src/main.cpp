#include <windows.h>

#include <fcntl.h>
#include <io.h>
#include <stdint.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstring>
#include <cwchar>
#include <cwctype>
#include <map>
#include <string>
#include <string_view>
#include <vector>

#include "json.hpp"
#include "../../win32-helper/include/minimaxh3_winbroker_abi.h"

namespace {

using relay::json::Value;

constexpr wchar_t kProfileArgument[] = L"--capability-profile=path-inspection-v1";
constexpr std::string_view kProfileId = "relay.win32.path-inspection";
constexpr std::string_view kProfileVersion = "1.0.0";
constexpr uint16_t kKindClientHello = MINIMAXH3_WINBROKER_MESSAGE_CLIENT_HELLO;
constexpr uint16_t kKindServerHello = MINIMAXH3_WINBROKER_MESSAGE_SERVER_HELLO;
constexpr uint16_t kKindRequest = MINIMAXH3_WINBROKER_MESSAGE_REQUEST;
constexpr uint16_t kKindResponse = MINIMAXH3_WINBROKER_MESSAGE_RESPONSE;
constexpr uint16_t kKindClose = MINIMAXH3_WINBROKER_MESSAGE_CLOSE;
constexpr uint16_t kInspectVolume = MINIMAXH3_WINBROKER_OPCODE_INSPECT_VOLUME_CANDIDATE;
constexpr uint16_t kValidatePath = MINIMAXH3_WINBROKER_OPCODE_VALIDATE_PATH_IDENTITY;

bool ReadExact(void* output, size_t length) {
  auto* cursor = static_cast<unsigned char*>(output);
  size_t total = 0;
  while (total < length) {
    const unsigned int step = static_cast<unsigned int>(
        std::min<size_t>(length - total, 1u << 20));
    const int count = _read(_fileno(stdin), cursor + total, step);
    if (count <= 0) return false;
    total += static_cast<size_t>(count);
  }
  return true;
}

bool WriteExact(const void* input, size_t length) {
  const auto* cursor = static_cast<const unsigned char*>(input);
  size_t total = 0;
  while (total < length) {
    const unsigned int step = static_cast<unsigned int>(
        std::min<size_t>(length - total, 1u << 20));
    const int count = _write(_fileno(stdout), cursor + total, step);
    if (count <= 0) return false;
    total += static_cast<size_t>(count);
  }
  return true;
}

Value Object(std::initializer_list<std::pair<const std::string, Value>> fields) {
  std::map<std::string, Value, std::less<>> object;
  for (const auto& field : fields) object.emplace(field.first, field.second);
  return Value::Object(std::move(object));
}

bool HasExactKeys(const Value& value, std::initializer_list<std::string_view> keys) {
  if (value.type != Value::Type::kObject || value.object.size() != keys.size()) return false;
  for (const std::string_view key : keys) {
    if (value.Find(key) == nullptr) return false;
  }
  return true;
}

const std::string* StringField(const Value& value, std::string_view key) {
  const Value* field = value.Find(key);
  return field != nullptr && field->type == Value::Type::kString ? &field->string : nullptr;
}

const bool* BoolField(const Value& value, std::string_view key) {
  const Value* field = value.Find(key);
  return field != nullptr && field->type == Value::Type::kBool ? &field->boolean : nullptr;
}

Value Error(std::string code, std::string rule) {
  return Object({
      {"code", Value::String(std::move(code))},
      {"operation_effect", Value::String("none")},
      {"rule_id", Value::String(std::move(rule))},
      {"status", Value::String("error")},
  });
}

bool IsAbsoluteUnambiguousDrivePath(const std::wstring& path) {
  if (path.size() < 3 || path.size() > 32767 ||
      !std::iswalpha(static_cast<wint_t>(path[0])) || path[1] != L':' || path[2] != L'\\') {
    return false;
  }
  if (path.rfind(L"\\\\", 0) == 0 || path.rfind(L"\\?\\", 0) == 0 ||
      path.rfind(L"\\.\\", 0) == 0 || path.find(L'/') != std::wstring::npos ||
      path.find(L'\0') != std::wstring::npos) {
    return false;
  }
  for (size_t index = 2; index < path.size(); ++index) {
    if (path[index] == L':') return false;
  }
  size_t segment_start = 3;
  while (segment_start < path.size()) {
    const size_t separator = path.find(L'\\', segment_start);
    const size_t segment_end = separator == std::wstring::npos ? path.size() : separator;
    if (segment_end > segment_start) {
      const wchar_t tail = path[segment_end - 1];
      if (tail == L'.' || tail == L' ') return false;
    }
    if (separator == std::wstring::npos) break;
    segment_start = separator + 1;
  }
  return true;
}

std::wstring Utf8ToWide(std::string_view value) {
  if (value.empty() || !relay::json::IsValidUtf8(value) ||
      value.size() > static_cast<size_t>(INT_MAX)) {
    return {};
  }
  const int length = static_cast<int>(value.size());
  const int needed = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), length,
                                         nullptr, 0);
  if (needed <= 0) return {};
  std::wstring result(static_cast<size_t>(needed), L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), length,
                          result.data(), needed) != needed) {
    return {};
  }
  return result;
}

std::string WideToUtf8(std::wstring_view value) {
  if (value.empty() || value.size() > static_cast<size_t>(INT_MAX)) return {};
  const int length = static_cast<int>(value.size());
  const int needed = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), length,
                                         nullptr, 0, nullptr, nullptr);
  if (needed <= 0) return {};
  std::string result(static_cast<size_t>(needed), '\0');
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), length,
                          result.data(), needed, nullptr, nullptr) != needed) {
    return {};
  }
  return result;
}

Value InspectVolume(const Value& request) {
  if (!HasExactKeys(request, {"candidate_kind", "candidate_path", "require_fixed_local",
                              "required_filesystem"})) {
    return Error("RELAY_NATIVE.INVALID_REQUEST", "profile.inspect.closed-body");
  }
  const std::string* candidate = StringField(request, "candidate_path");
  const std::string* candidate_kind = StringField(request, "candidate_kind");
  const std::string* required_filesystem = StringField(request, "required_filesystem");
  const bool* require_fixed = BoolField(request, "require_fixed_local");
  if (candidate == nullptr || candidate_kind == nullptr || candidate_kind->empty() ||
      candidate_kind->size() > 64 || required_filesystem == nullptr ||
      *required_filesystem != "ntfs" || require_fixed == nullptr || !*require_fixed) {
    return Error("RELAY_NATIVE.INVALID_REQUEST", "profile.inspect.field-policy");
  }
  const std::wstring path = Utf8ToWide(*candidate);
  if (!IsAbsoluteUnambiguousDrivePath(path)) {
    return Error("RELAY_NATIVE.PATH_INVALID", "profile.path.absolute-drive-only");
  }
  std::array<wchar_t, MAX_PATH + 1> volume_path{};
  if (!GetVolumePathNameW(path.c_str(), volume_path.data(),
                          static_cast<DWORD>(volume_path.size()))) {
    return Error("RELAY_NATIVE.VOLUME_UNSUPPORTED", "profile.inspect.volume-root");
  }
  std::array<wchar_t, MAX_PATH + 1> filesystem{};
  DWORD serial = 0;
  DWORD max_component = 0;
  DWORD flags = 0;
  if (!GetVolumeInformationW(volume_path.data(), nullptr, 0, &serial, &max_component, &flags,
                             filesystem.data(), static_cast<DWORD>(filesystem.size()))) {
    return Error("RELAY_NATIVE.VOLUME_UNSUPPORTED", "profile.inspect.volume-information");
  }
  std::string filesystem_name = WideToUtf8(filesystem.data());
  std::transform(filesystem_name.begin(), filesystem_name.end(), filesystem_name.begin(),
                 [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
  const UINT drive_type = GetDriveTypeW(volume_path.data());
  const bool fixed_local = drive_type == DRIVE_FIXED;
  const bool supported = fixed_local && filesystem_name == "ntfs";
  return Object({
      {"drive_type", Value::Integer(static_cast<int64_t>(drive_type))},
      {"filesystem", Value::String(std::move(filesystem_name))},
      {"fixed_local", Value::Bool(fixed_local)},
      {"status", Value::String("ok")},
      {"supported", Value::Bool(supported)},
  });
}

Value ValidatePath(const Value& request) {
  if (!HasExactKeys(request, {"candidate_path", "mutation_policy", "purpose"})) {
    return Error("RELAY_NATIVE.INVALID_REQUEST", "profile.validate.closed-body");
  }
  const std::string* candidate = StringField(request, "candidate_path");
  const std::string* mutation_policy = StringField(request, "mutation_policy");
  const std::string* purpose = StringField(request, "purpose");
  if (candidate == nullptr || mutation_policy == nullptr || *mutation_policy != "read_only" ||
      purpose == nullptr || purpose->empty() || purpose->size() > 64) {
    return Error("RELAY_NATIVE.INVALID_REQUEST", "profile.validate.field-policy");
  }
  const std::wstring path = Utf8ToWide(*candidate);
  if (!IsAbsoluteUnambiguousDrivePath(path)) {
    return Error("RELAY_NATIVE.PATH_INVALID", "profile.path.absolute-drive-only");
  }
  const HANDLE handle = CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES,
                                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                    nullptr, OPEN_EXISTING,
                                    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                                    nullptr);
  if (handle == INVALID_HANDLE_VALUE) {
    return Error("RELAY_NATIVE.PATH_INVALID", "profile.validate.open-existing");
  }
  FILE_ATTRIBUTE_TAG_INFO tag{};
  const BOOL tag_ok = GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &tag, sizeof(tag));
  std::array<wchar_t, 32768> final_path{};
  const DWORD final_length = GetFinalPathNameByHandleW(handle, final_path.data(),
                                                       static_cast<DWORD>(final_path.size()),
                                                       FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  CloseHandle(handle);
  if (!tag_ok || final_length == 0 || final_length >= final_path.size()) {
    return Error("RELAY_NATIVE.PATH_INVALID", "profile.validate.canonical-handle");
  }
  if ((tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
    return Error("RELAY_NATIVE.PATH_REPARSE_REJECTED", "profile.validate.reparse-final-object");
  }
  return Object({
      {"canonicalized", Value::Bool(true)},
      {"exists", Value::Bool(true)},
      {"reparse", Value::Bool(false)},
      {"status", Value::String("ok")},
  });
}

bool WriteFrame(uint16_t kind, uint16_t opcode, uint64_t sequence, const Value& payload) {
  const std::string bytes = relay::json::Canonicalize(payload);
  if (bytes.empty() || bytes.size() > MINIMAXH3_WINBROKER_CONTROL_MAX_PAYLOAD_BYTES) return false;
  minimaxh3_winbroker_control_frame_header_v1 header{};
  std::memcpy(header.magic, "MH3W", 4);
  header.header_size_le = MINIMAXH3_WINBROKER_CONTROL_HEADER_BYTES;
  header.framing_version_le = MINIMAXH3_WINBROKER_CONTROL_FRAMING_VERSION;
  header.payload_length_le = static_cast<uint32_t>(bytes.size());
  header.message_kind_le = kind;
  header.opcode_le = opcode;
  header.flags_le = 0;
  header.sequence_le = sequence;
  header.reserved_le = 0;
  return WriteExact(&header, sizeof(header)) && WriteExact(bytes.data(), bytes.size());
}

int RunProfile() {
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  uint64_t expected_input_sequence = 0;
  uint64_t output_sequence = 0;
  bool ready = false;
  while (true) {
    minimaxh3_winbroker_control_frame_header_v1 header{};
    if (!ReadExact(&header, sizeof(header))) return ready ? 0 : 20;
    if (std::memcmp(header.magic, "MH3W", 4) != 0) return 21;
    if (header.header_size_le != MINIMAXH3_WINBROKER_CONTROL_HEADER_BYTES ||
        header.framing_version_le != MINIMAXH3_WINBROKER_CONTROL_FRAMING_VERSION ||
        header.flags_le != 0 || header.reserved_le != 0) {
      return 22;
    }
    const uint32_t payload_length = header.payload_length_le;
    if (payload_length == 0 || payload_length > MINIMAXH3_WINBROKER_CONTROL_MAX_PAYLOAD_BYTES) {
      return 23;
    }
    if (header.sequence_le != expected_input_sequence++) return 24;
    std::string payload_bytes(payload_length, '\0');
    if (!ReadExact(payload_bytes.data(), payload_bytes.size())) return 25;
    Value payload;
    std::string parse_error;
    if (!relay::json::ParseCanonical(payload_bytes, &payload, &parse_error)) return 26;

    const uint16_t kind = header.message_kind_le;
    const uint16_t opcode = header.opcode_le;
    if (kind == kKindClose && opcode == 0) {
      if (!HasExactKeys(payload, {"message_kind", "profile_id", "profile_version"}) ||
          StringField(payload, "message_kind") == nullptr ||
          *StringField(payload, "message_kind") != "close" ||
          StringField(payload, "profile_id") == nullptr ||
          *StringField(payload, "profile_id") != kProfileId ||
          StringField(payload, "profile_version") == nullptr ||
          *StringField(payload, "profile_version") != kProfileVersion) {
        return 27;
      }
      return 0;
    }
    if (!ready) {
      if (kind != kKindClientHello || opcode != 0 ||
          !HasExactKeys(payload, {"message_kind", "profile_id", "profile_version"}) ||
          StringField(payload, "message_kind") == nullptr ||
          *StringField(payload, "message_kind") != "client_hello" ||
          StringField(payload, "profile_id") == nullptr ||
          *StringField(payload, "profile_id") != kProfileId ||
          StringField(payload, "profile_version") == nullptr ||
          *StringField(payload, "profile_version") != kProfileVersion) {
        return 28;
      }
      ready = true;
      const Value response = Object({
          {"build_state", Value::String("internal_unsigned")},
          {"enabled_opcodes", Value::Array({Value::Integer(kInspectVolume),
                                             Value::Integer(kValidatePath)})},
          {"message_kind", Value::String("server_hello")},
          {"profile_id", Value::String(std::string(kProfileId))},
          {"profile_version", Value::String(std::string(kProfileVersion))},
          {"status", Value::String("ready")},
      });
      if (!WriteFrame(kKindServerHello, 0, output_sequence++, response)) return 29;
      continue;
    }
    if (kind != kKindRequest) return 30;
    Value response;
    if (opcode == kInspectVolume) {
      response = InspectVolume(payload);
    } else if (opcode == kValidatePath) {
      response = ValidatePath(payload);
    } else {
      response = Error("RELAY_NATIVE.OPCODE_NOT_ENABLED", "profile.operation.enabled-set");
    }
    if (!WriteFrame(kKindResponse, opcode, output_sequence++, response)) return 31;
  }
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc != 2 || std::wcscmp(argv[1], kProfileArgument) != 0) return 10;
  return RunProfile();
}
