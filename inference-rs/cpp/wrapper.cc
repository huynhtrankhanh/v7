#include "wrapper.h"
#include "lm/model.hh"
#include "lm/virtual_interface.hh"
#include "util/file.hh"
#include <iostream>
#include <string>

namespace {
thread_local std::string model_error;
}

ModelPtr load_model(const char* path) {
    try {
        model_error.clear();
        lm::ngram::Config config;
        config.show_progress = false;
        lm::base::Model* model = lm::ngram::LoadVirtual(path, config);
        return static_cast<ModelPtr>(model);
    } catch (const std::exception& e) {
        model_error = e.what();
        std::cerr << "Error loading model: " << e.what() << std::endl;
        return nullptr;
    }
}

ModelPtr load_model_fd(int fd, const char* name) {
    try {
        model_error.clear();
        lm::ngram::Config config;
        config.show_progress = false;
        lm::base::Model* model = lm::ngram::LoadVirtual(
            util::DupOrThrow(fd),
            name,
            config
        );
        return static_cast<ModelPtr>(model);
    } catch (const std::exception& e) {
        model_error = e.what();
        std::cerr << "Error loading model descriptor: " << e.what() << std::endl;
        return nullptr;
    }
}

const char* last_model_error() {
    return model_error.c_str();
}

void destroy_model(ModelPtr model) {
    delete static_cast<lm::base::Model*>(model);
}

float score_model(const ModelPtr model, const void* in_state, unsigned int new_word, void* out_state) {
    const lm::base::Model* m = static_cast<const lm::base::Model*>(model);
    return m->BaseScore(in_state, new_word, out_state);
}

unsigned int get_word_index(const ModelPtr model, const char* word) {
    const lm::base::Model* m = static_cast<const lm::base::Model*>(model);
    return m->BaseVocabulary().Index(word);
}

size_t get_state_size(const ModelPtr model) {
    const lm::base::Model* m = static_cast<const lm::base::Model*>(model);
    return m->StateSize();
}

void begin_sentence_write(const ModelPtr model, void* to) {
    const lm::base::Model* m = static_cast<const lm::base::Model*>(model);
    m->BeginSentenceWrite(to);
}

void null_context_write(const ModelPtr model, void* to) {
    const lm::base::Model* m = static_cast<const lm::base::Model*>(model);
    m->NullContextWrite(to);
}

unsigned int get_order(const ModelPtr model) {
     const lm::base::Model* m = static_cast<const lm::base::Model*>(model);
     return m->Order();
}
