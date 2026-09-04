#ifndef RELAY_WINBROKER_JSON_HPP_
#define RELAY_WINBROKER_JSON_HPP_

#include <cstdint>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace relay::json {

struct Value {
  enum class Type { kNull, kBool, kInteger, kString, kArray, kObject };

  Type type = Type::kNull;
  bool boolean = false;
  int64_t integer = 0;
  std::string string;
  std::vector<Value> array;
  std::map<std::string, Value, std::less<>> object;

  static Value Null();
  static Value Bool(bool input);
  static Value Integer(int64_t input);
  static Value String(std::string input);
  static Value Array(std::vector<Value> input);
  static Value Object(std::map<std::string, Value, std::less<>> input = {});

  const Value* Find(std::string_view key) const;
  Value* Find(std::string_view key);
};

bool ParseCanonical(std::string_view input, Value* output, std::string* error);
std::string Canonicalize(const Value& value);
bool IsValidUtf8(std::string_view value);

}  // namespace relay::json

#endif
