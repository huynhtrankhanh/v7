#pragma once
#include <cstddef>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* ModelPtr;

ModelPtr load_model(const char* path);
void destroy_model(ModelPtr model);

float score_model(const ModelPtr model, const void* in_state, unsigned int new_word, void* out_state);

unsigned int get_word_index(const ModelPtr model, const char* word);

size_t get_state_size(const ModelPtr model);
void begin_sentence_write(const ModelPtr model, void* to);
void null_context_write(const ModelPtr model, void* to);
unsigned int get_order(const ModelPtr model);

#ifdef __cplusplus
}
#endif
