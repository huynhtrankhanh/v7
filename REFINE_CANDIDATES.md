# Refine Candidates Process

Input String: `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7`
Target Sentence (Guide): `nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt`

## Step 1

**Input Templates**: `na0 tro2`

**Current Context**: `(Empty)`

**Candidates**:
1. nâu tròn
2. nay trò
3. năm trò
4. nam tròn
5. nâu trồng
6. nai tròn
7. năng trời

**Selected Candidate**: 1 (`nâu tròn`)

## Step 2

**Input Templates**: `đe7 la1`

**Current Context**: `nâu tròn`

**Candidates**:
1. đẹp lá
2. đẹp lấy
3. đẹp lấm
4. đẹp lái
5. đẹp lắng
6. đẹp láng
7. đẹp lánh

**Selected Candidate**: 1 (`đẹp lá`)

## Step 3

**Input Templates**: `nhu0 ma2`

**Current Context**: `nâu tròn đẹp lá`

**Candidates**:
1. nhưng màu
2. như màu
3. nhung màu
4. nhưng mà
5. như màn
6. nhưng màn
7. nhung màng

**Selected Candidate**: 4 (`nhưng mà`)

## Step 4

**Input Templates**: `khi0 tro2`

**Current Context**: `nâu tròn đẹp lá nhưng mà`

**Candidates**:
1. khi tròn
2. khi trời
3. khi trồng
4. khi trò
5. khinh trời
6. khinh tròn
7. khiên trời

**Selected Candidate**: 2 (`khi trời`)

## Step 5

**Input Templates**: `mu0 thi2`

**Current Context**: `nâu tròn đẹp lá nhưng mà khi trời`

**Candidates**:
1. mưa thì
2. mua thì
3. muôn thì
4. mưa thiều
5. mưng thìa
6. mưa thiền
7. mưa thìa

**Selected Candidate**: 1 (`mưa thì`)

## Step 6

**Input Templates**: `no1 ra6`

**Current Context**: `nâu tròn đẹp lá nhưng mà khi trời mưa thì`

**Candidates**:
1. nó rất
2. nóng rất
3. nói rất
4. nó rắc
5. nó rác
6. nó rách
7. nón rất

**Selected Candidate**: 1 (`nó rất`)

## Step 7

**Input Templates**: `me7`

**Current Context**: `nâu tròn đẹp lá nhưng mà khi trời mưa thì nó rất`

**Candidates**:
1. mệt
2. mệp
3. mẹt
4. mẹc
5. mẹp
6. mệch

**Selected Candidate**: 1 (`mệt`)

# Final Result

`nâu tròn đẹp lá nhưng mà khi trời mưa thì nó rất mệt`
