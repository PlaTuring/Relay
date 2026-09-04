#include "json.hpp"

#include <charconv>
#include <limits>
#include <utility>

namespace relay::json {
namespace {

bool AppendUtf8(uint32_t codepoint, std::string* output) {
  if (codepoint <= 0x7fu) {
    output->push_back(static_cast<char>(codepoint));
  } else if (codepoint <= 0x7ffu) {
    output->push_back(static_cast<char>(0xc0u | (codepoint >> 6u)));
    output->push_back(static_cast<char>(0x80u | (codepoint & 0x3fu)));
  } else if (codepoint <= 0xffffu && !(codepoint >= 0xd800u && codepoint <= 0xdfffu)) {
    output->push_back(static_cast<char>(0xe0u | (codepoint >> 12u)));
    output->push_back(static_cast<char>(0x80u | ((codepoint >> 6u) & 0x3fu)));
    output->push_back(static_cast<char>(0x80u | (codepoint & 0x3fu)));
  } else if (codepoint <= 0x10ffffu) {
    output->push_back(static_cast<char>(0xf0u | (codepoint >> 18u)));
    output->push_back(static_cast<char>(0x80u | ((codepoint >> 12u) & 0x3fu)));
    output->push_back(static_cast<char>(0x80u | ((codepoint >> 6u) & 0x3fu)));
    output->push_back(static_cast<char>(0x80u | (codepoint & 0x3fu)));
  } else {
    return false;
  }
  return true;
}

bool HexDigit(const char input, uint16_t* output) {
  if (input >= '0' && input <= '9') {
    *output = static_cast<uint16_t>(input - '0');
    return true;
  }
  if (input >= 'a' && input <= 'f') {
    *output = static_cast<uint16_t>(input - 'a' + 10);
    return true;
  }
  if (input >= 'A' && input <= 'F') {
    *output = static_cast<uint16_t>(input - 'A' + 10);
    return true;
  }
  return false;
}

class Parser {
 public:
  explicit Parser(std::string_view input) : input_(input) {}

  bool Parse(Value* output, std::string* error) {
    if (input_.empty() || (input_.size() >= 3 &&
        static_cast<unsigned char>(input_[0]) == 0xefu &&
        static_cast<unsigned char>(input_[1]) == 0xbbu &&
        static_cast<unsigned char>(input_[2]) == 0xbfu)) {
      return Fail("invalid-bom-or-empty", error);
    }
    if (!ParseValue(output, error) || offset_ != input_.size()) return Fail("trailing-data", error);
    return true;
  }

 private:
  bool Fail(std::string_view message, std::string* error) const {
    if (error != nullptr) *error = std::string(message);
    return false;
  }

  bool Consume(std::string_view token) {
    if (input_.substr(offset_, token.size()) != token) return false;
    offset_ += token.size();
    return true;
  }

  bool ParseValue(Value* output, std::string* error) {
    if (offset_ >= input_.size()) return Fail("unexpected-eof", error);
    const char lead = input_[offset_];
    if (lead == 'n' && Consume("null")) {
      *output = Value::Null();
      return true;
    }
    if (lead == 't' && Consume("true")) {
      *output = Value::Bool(true);
      return true;
    }
    if (lead == 'f' && Consume("false")) {
      *output = Value::Bool(false);
      return true;
    }
    if (lead == '"') {
      std::string value;
      if (!ParseString(&value, error)) return false;
      *output = Value::String(std::move(value));
      return true;
    }
    if (lead == '[') return ParseArray(output, error);
    if (lead == '{') return ParseObject(output, error);
    if (lead == '-' || (lead >= '0' && lead <= '9')) return ParseInteger(output, error);
    return Fail("unexpected-token", error);
  }

  bool ParseString(std::string* output, std::string* error) {
    if (offset_ >= input_.size() || input_[offset_++] != '"') return Fail("expected-string", error);
    std::string decoded;
    while (offset_ < input_.size()) {
      const char value = input_[offset_++];
      if (value == '"') {
        if (!IsValidUtf8(decoded)) return Fail("invalid-utf8", error);
        *output = std::move(decoded);
        return true;
      }
      if (static_cast<unsigned char>(value) < 0x20u) return Fail("control-in-string", error);
      if (value != '\\') {
        decoded.push_back(value);
        continue;
      }
      if (offset_ >= input_.size()) return Fail("bad-escape", error);
      const char escaped = input_[offset_++];
      switch (escaped) {
        case '"': decoded.push_back('"'); break;
        case '\\': decoded.push_back('\\'); break;
        case '/': decoded.push_back('/'); break;
        case 'b': decoded.push_back('\b'); break;
        case 'f': decoded.push_back('\f'); break;
        case 'n': decoded.push_back('\n'); break;
        case 'r': decoded.push_back('\r'); break;
        case 't': decoded.push_back('\t'); break;
        case 'u': {
          if (offset_ + 4 > input_.size()) return Fail("bad-unicode-escape", error);
          uint16_t first = 0;
          for (size_t count = 0; count < 4; ++count) {
            uint16_t digit = 0;
            if (!HexDigit(input_[offset_++], &digit)) return Fail("bad-unicode-escape", error);
            first = static_cast<uint16_t>((first << 4u) | digit);
          }
          uint32_t codepoint = first;
          if (first >= 0xd800u && first <= 0xdbffu) {
            if (offset_ + 6 > input_.size() || input_[offset_] != '\\' || input_[offset_ + 1] != 'u') {
              return Fail("unpaired-surrogate", error);
            }
            offset_ += 2;
            uint16_t second = 0;
            for (size_t count = 0; count < 4; ++count) {
              uint16_t digit = 0;
              if (!HexDigit(input_[offset_++], &digit)) return Fail("bad-unicode-escape", error);
              second = static_cast<uint16_t>((second << 4u) | digit);
            }
            if (second < 0xdc00u || second > 0xdfffu) return Fail("unpaired-surrogate", error);
            codepoint = 0x10000u + ((first - 0xd800u) << 10u) + (second - 0xdc00u);
          } else if (first >= 0xdc00u && first <= 0xdfffu) {
            return Fail("unpaired-surrogate", error);
          }
          if (!AppendUtf8(codepoint, &decoded)) return Fail("bad-codepoint", error);
          break;
        }
        default: return Fail("bad-escape", error);
      }
    }
    return Fail("unterminated-string", error);
  }

  bool ParseInteger(Value* output, std::string* error) {
    const size_t start = offset_;
    if (input_[offset_] == '-') ++offset_;
    if (offset_ >= input_.size()) return Fail("bad-integer", error);
    if (input_[offset_] == '0') {
      ++offset_;
      if (offset_ < input_.size() && input_[offset_] >= '0' && input_[offset_] <= '9') {
        return Fail("leading-zero", error);
      }
    } else {
      if (input_[offset_] < '1' || input_[offset_] > '9') return Fail("bad-integer", error);
      while (offset_ < input_.size() && input_[offset_] >= '0' && input_[offset_] <= '9') ++offset_;
    }
    if (offset_ < input_.size() && (input_[offset_] == '.' || input_[offset_] == 'e' || input_[offset_] == 'E')) {
      return Fail("non-integer-number", error);
    }
    int64_t value = 0;
    const auto result = std::from_chars(input_.data() + start, input_.data() + offset_, value);
    if (result.ec != std::errc{} || result.ptr != input_.data() + offset_) return Fail("integer-range", error);
    *output = Value::Integer(value);
    return true;
  }

  bool ParseArray(Value* output, std::string* error) {
    ++offset_;
    std::vector<Value> values;
    if (offset_ < input_.size() && input_[offset_] == ']') {
      ++offset_;
      *output = Value::Array(std::move(values));
      return true;
    }
    while (true) {
      Value value;
      if (!ParseValue(&value, error)) return false;
      values.push_back(std::move(value));
      if (offset_ >= input_.size()) return Fail("unterminated-array", error);
      if (input_[offset_] == ']') {
        ++offset_;
        *output = Value::Array(std::move(values));
        return true;
      }
      if (input_[offset_++] != ',') return Fail("array-separator", error);
    }
  }

  bool ParseObject(Value* output, std::string* error) {
    ++offset_;
    std::map<std::string, Value, std::less<>> values;
    if (offset_ < input_.size() && input_[offset_] == '}') {
      ++offset_;
      *output = Value::Object(std::move(values));
      return true;
    }
    while (true) {
      std::string key;
      if (!ParseString(&key, error)) return false;
      if (offset_ >= input_.size() || input_[offset_++] != ':') return Fail("object-colon", error);
      Value value;
      if (!ParseValue(&value, error)) return false;
      if (!values.emplace(std::move(key), std::move(value)).second) return Fail("duplicate-key", error);
      if (offset_ >= input_.size()) return Fail("unterminated-object", error);
      if (input_[offset_] == '}') {
        ++offset_;
        *output = Value::Object(std::move(values));
        return true;
      }
      if (input_[offset_++] != ',') return Fail("object-separator", error);
    }
  }

  std::string_view input_;
  size_t offset_ = 0;
};

void AppendEscaped(std::string_view value, std::string* output) {
  static constexpr char kHex[] = "0123456789abcdef";
  output->push_back('"');
  for (const unsigned char character : value) {
    switch (character) {
      case '"': *output += "\\\""; break;
      case '\\': *output += "\\\\"; break;
      case '\b': *output += "\\b"; break;
      case '\f': *output += "\\f"; break;
      case '\n': *output += "\\n"; break;
      case '\r': *output += "\\r"; break;
      case '\t': *output += "\\t"; break;
      default:
        if (character < 0x20u) {
          *output += "\\u00";
          output->push_back(kHex[character >> 4u]);
          output->push_back(kHex[character & 0x0fu]);
        } else {
          output->push_back(static_cast<char>(character));
        }
    }
  }
  output->push_back('"');
}

void AppendCanonical(const Value& value, std::string* output) {
  switch (value.type) {
    case Value::Type::kNull: *output += "null"; return;
    case Value::Type::kBool: *output += value.boolean ? "true" : "false"; return;
    case Value::Type::kInteger: *output += std::to_string(value.integer); return;
    case Value::Type::kString: AppendEscaped(value.string, output); return;
    case Value::Type::kArray:
      output->push_back('[');
      for (size_t index = 0; index < value.array.size(); ++index) {
        if (index != 0) output->push_back(',');
        AppendCanonical(value.array[index], output);
      }
      output->push_back(']');
      return;
    case Value::Type::kObject:
      output->push_back('{');
      {
        size_t index = 0;
        for (const auto& [key, item] : value.object) {
          if (index++ != 0) output->push_back(',');
          AppendEscaped(key, output);
          output->push_back(':');
          AppendCanonical(item, output);
        }
      }
      output->push_back('}');
      return;
  }
}

}  // namespace

Value Value::Null() { return {}; }
Value Value::Bool(const bool input) { Value value; value.type = Type::kBool; value.boolean = input; return value; }
Value Value::Integer(const int64_t input) { Value value; value.type = Type::kInteger; value.integer = input; return value; }
Value Value::String(std::string input) { Value value; value.type = Type::kString; value.string = std::move(input); return value; }
Value Value::Array(std::vector<Value> input) { Value value; value.type = Type::kArray; value.array = std::move(input); return value; }
Value Value::Object(std::map<std::string, Value, std::less<>> input) { Value value; value.type = Type::kObject; value.object = std::move(input); return value; }

const Value* Value::Find(const std::string_view key) const {
  if (type != Type::kObject) return nullptr;
  const auto iterator = object.find(key);
  return iterator == object.end() ? nullptr : &iterator->second;
}

Value* Value::Find(const std::string_view key) {
  if (type != Type::kObject) return nullptr;
  const auto iterator = object.find(key);
  return iterator == object.end() ? nullptr : &iterator->second;
}

bool ParseCanonical(const std::string_view input, Value* output, std::string* error) {
  if (!IsValidUtf8(input)) {
    if (error != nullptr) *error = "invalid-utf8";
    return false;
  }
  Parser parser(input);
  if (!parser.Parse(output, error)) return false;
  if (Canonicalize(*output) != input) {
    if (error != nullptr) *error = "non-canonical-json";
    return false;
  }
  return true;
}

std::string Canonicalize(const Value& value) {
  std::string output;
  AppendCanonical(value, &output);
  return output;
}

bool IsValidUtf8(const std::string_view value) {
  size_t index = 0;
  while (index < value.size()) {
    const unsigned char lead = static_cast<unsigned char>(value[index]);
    size_t count = 0;
    uint32_t codepoint = 0;
    if (lead <= 0x7fu) { count = 1; codepoint = lead; }
    else if ((lead & 0xe0u) == 0xc0u) { count = 2; codepoint = lead & 0x1fu; if (codepoint == 0) return false; }
    else if ((lead & 0xf0u) == 0xe0u) { count = 3; codepoint = lead & 0x0fu; }
    else if ((lead & 0xf8u) == 0xf0u) { count = 4; codepoint = lead & 0x07u; }
    else return false;
    if (index + count > value.size()) return false;
    for (size_t offset = 1; offset < count; ++offset) {
      const unsigned char next = static_cast<unsigned char>(value[index + offset]);
      if ((next & 0xc0u) != 0x80u) return false;
      codepoint = (codepoint << 6u) | (next & 0x3fu);
    }
    if ((count == 2 && codepoint < 0x80u) || (count == 3 && codepoint < 0x800u) ||
        (count == 4 && codepoint < 0x10000u) || codepoint > 0x10ffffu ||
        (codepoint >= 0xd800u && codepoint <= 0xdfffu)) return false;
    index += count;
  }
  return true;
}

}  // namespace relay::json
