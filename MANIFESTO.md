# Improve training and inference
## Word segmentation
Use underthesea to perform word segmentation prior to KenLM training. This also means the inference algorithm in the inference-rs folder has to account for word segmentation now. It has to calculate how many syllables to consume to make a word. I recommend that we consume from 1 to 5 syllables, don't go beyond 5. Of course, how many syllables to consume **ultimately depends on whether the decision leads to a high KenLM score or not**, so this is fundamentally an optimization problem. **That's right, segmenting into words is an optimization problem.** A word can cross island boundaries. So both fixed text islands and v7 islands have to be segmented as a whole, not in a siloed manner.

## Punctuation
Punctuation should be considered tokens in their own right. Only these punctuation marks are supported: full stop, exclamation mark, comma, semicolon, colon.

## KenLM installation
KenLM is already installed in the docker-compose.yml file. You just need to run in the context of the container.

## Dataset
Use this dataset when testing. Do not commit the dataset or the resulting model to the repository. This is only to test the approach. The model will be trained on the complete dataset later. This is a small dataset for testing and validation.

https://github.com/hoanganhpham1006/Vietnamese_Language_Model/blob/master/Train_Full.zip
