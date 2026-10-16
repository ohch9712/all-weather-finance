from typing import Annotated

from fastapi import Depends

from app.integrations.llm.structured import RoutedStructuredLLM, StructuredLLM


def get_structured_llm() -> StructuredLLM:
    return RoutedStructuredLLM()


StructuredLLMDep = Annotated[StructuredLLM, Depends(get_structured_llm)]
