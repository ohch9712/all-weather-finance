from pydantic import BaseModel


def portable_json_schema(model: type[BaseModel]) -> dict:
    source = model.model_json_schema()
    definitions = source.get("$defs", {})
    allowed = {
        "type",
        "properties",
        "required",
        "enum",
        "items",
        "anyOf",
        "additionalProperties",
        "description",
        "format",
    }

    def convert(node: dict, refs: tuple[str, ...] = ()) -> dict:
        if "$ref" in node:
            ref = node["$ref"]
            if ref in refs:
                raise ValueError("재귀 모델은 AI 스키마로 변환할 수 없습니다.")
            prefix = "#/$defs/"
            if not ref.startswith(prefix) or ref[len(prefix) :] not in definitions:
                raise ValueError("지원하지 않는 스키마 참조입니다.")
            merged = definitions[ref[len(prefix) :]] | {
                key: value for key, value in node.items() if key != "$ref"
            }
            return convert(merged, (*refs, ref))
        result = {}
        for key, value in node.items():
            if key == "const":
                result["enum"] = [value]
            elif key in {"anyOf", "oneOf"}:
                result["anyOf"] = [convert(child, refs) for child in value]
            elif key == "properties":
                result[key] = {name: convert(child, refs) for name, child in value.items()}
            elif key == "items":
                result[key] = convert(value, refs)
            elif key == "format":
                if value in {"date", "date-time"}:
                    result[key] = value
            elif key in allowed:
                result[key] = value
        if result.get("type") == "object":
            result["additionalProperties"] = False
            result["required"] = list(result.get("properties", {}))
        return result

    return convert(source)
