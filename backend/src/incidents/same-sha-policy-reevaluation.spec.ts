import * as assert from 'node:assert/strict';
import { IncidentsService, buildPrValidationJobName } from './incidents.service';

// R67 — same-SHA policy reevaluation. Offline (mocked fetch, mocked repo/
// transaction — same harness pattern as corrective-convergence.spec.ts),
// no real network, no real DB. The positive/PR34 fixtures use the exact
// real PR #34 source text and blob SHAs (recovered earlier via GitHub and
// the live incident record) so the recompute is proven against the real
// defect, not a synthetic stand-in — nothing PR34-specific exists in
// incidents.service.ts itself.

const BASE_SHA = '6ed56ff791acbf3e111431285bef7b30c8076084';
const HEAD_SHA = 'dc1aa978719ca40e6339e075cfe52a79875b2342';
const REPO = 'souhaiel11/pfe-app-test';
const JOB = 'pfe-app-test';
const PR = 34;
const TASK_MODEL_PATH = 'src/main/java/com/pfe/devsecops/model/Task.java';

const baseControllerContent = "package com.pfe.devsecops.controller;\n\nimport com.pfe.devsecops.model.Task;\nimport com.pfe.devsecops.service.TaskService;\nimport org.springframework.beans.factory.annotation.Autowired;\nimport org.springframework.http.ResponseEntity;\nimport org.springframework.web.bind.annotation.*;\n\nimport java.util.List;\n\n@RestController\n@RequestMapping(\"/api/tasks\")\npublic class TaskController {\n\n    @Autowired\n    private TaskService taskService;\n\n    @GetMapping\n    public ResponseEntity<List<Task>> getAllTasks() {\n        return ResponseEntity.ok(taskService.getAllTasks());\n    }\n\n    // VULNERABILITY Z4 — IDOR : pas de vérification ownership\n    // N'importe quel user authentifié peut voir la tâche de n'importe qui\n    // en changeant l'id dans l'URL\n    @GetMapping(\"/{id}\")\n    public ResponseEntity<Task> getTaskById(@PathVariable Long id) {\n        return taskService.getTaskById(id)\n                .map(ResponseEntity::ok)\n                .orElse(ResponseEntity.notFound().build());\n    }\n\n    @PostMapping\n    public ResponseEntity<Task> createTask(@RequestBody Task task) {\n        return ResponseEntity.ok(taskService.createTask(task));\n    }\n\n    @PutMapping(\"/{id}\")\n    public ResponseEntity<Task> updateTask(@PathVariable Long id, @RequestBody Task task) {\n        return ResponseEntity.ok(taskService.updateTask(id, task));\n    }\n\n    @DeleteMapping(\"/{id}\")\n    public ResponseEntity<Void> deleteTask(@PathVariable Long id) {\n        taskService.deleteTask(id);\n        return ResponseEntity.noContent().build();\n    }\n\n    // VULNERABILITY S1 — endpoint qui expose la SQL injection\n    @GetMapping(\"/search\")\n    public ResponseEntity<List<Task>> searchTasks(@RequestParam String title) {\n        // title est passé directement sans sanitization → SQL injection\n        return ResponseEntity.ok(taskService.searchTasksByTitle(title));\n    }\n\n    @PostMapping(\"/{id}/process\")\n    public ResponseEntity<String> processTask(@PathVariable Long id,\n                                               @RequestParam String action,\n                                               @RequestParam(defaultValue = \"USER\") String role,\n                                               @RequestParam(defaultValue = \"false\") boolean urgent,\n                                               @RequestParam(defaultValue = \"false\") boolean bulk) {\n        Task task = taskService.getTaskById(id)\n                .orElseThrow(() -> new RuntimeException(\"Task not found\"));\n        return ResponseEntity.ok(taskService.processTaskWorkflow(task, action, role, urgent, bulk));\n    }\n}\n";
const baseServiceContent = "package com.pfe.devsecops.service;\n\nimport com.pfe.devsecops.model.Task;\nimport com.pfe.devsecops.model.User;\nimport com.pfe.devsecops.repository.TaskRepository;\nimport org.slf4j.Logger;\nimport org.slf4j.LoggerFactory;\nimport org.springframework.beans.factory.annotation.Value;\nimport org.springframework.stereotype.Service;\n\nimport javax.persistence.EntityManager;\nimport javax.persistence.PersistenceContext;\nimport java.io.FileInputStream;\nimport java.io.IOException;\nimport java.time.LocalDateTime;\nimport java.util.List;\nimport java.util.Optional;\n\n@Service\npublic class TaskService {\n\n    private static final Logger logger = LoggerFactory.getLogger(TaskService.class);\n\n    // Constants for error messages\n    private static final String ERROR_TASK_NULL = \"ERROR: task is null\";\n    private static final String ERROR_TITLE_REQUIRED = \"ERROR: title required\";\n    private static final String ERROR_DESCRIPTION_REQUIRED = \"ERROR: description required\";\n    private static final String ERROR_PRIORITY_INVALID = \"ERROR: priority invalid\";\n    private static final String ROLE_ADMIN = \"ADMIN\";\n    private static final String ROLE_USER = \"USER\";\n    private static final String ACTION_CREATE = \"CREATE\";\n    private static final String ACTION_UPDATE = \"UPDATE\";\n    private static final String ACTION_DELETE = \"DELETE\";\n    private static final String ACTION_COMPLETE = \"COMPLETE\";\n    private static final String ACTION_CANCEL = \"CANCEL\";\n\n    @Value(\"${db.password:}\")\n    private String dbPassword;\n\n    @Value(\"${admin.username:}\")\n    private String adminUsername;\n\n    @Value(\"${admin.password:}\")\n    private String adminPassword;\n\n    private final TaskRepository taskRepository;\n\n    @PersistenceContext\n    private EntityManager entityManager;\n\n    public TaskService(TaskRepository taskRepository) {\n        this.taskRepository = taskRepository;\n    }\n\n    // ============================================================\n    // CRUD de base\n    // ============================================================\n\n    public List<Task> getAllTasks() {\n        return taskRepository.findAll();\n    }\n\n    public Optional<Task> getTaskById(Long id) {\n        return taskRepository.findById(id);\n    }\n\n    public List<Task> getTasksByUser(Long userId) {\n        return taskRepository.findByUserId(userId);\n    }\n\n    public Task createTask(Task task) {\n        task.setCreatedAt(LocalDateTime.now());\n        return taskRepository.save(task);\n    }\n\n    public Task updateTask(Long id, Task updatedTask) {\n        Task existing = taskRepository.findById(id)\n                .orElseThrow(() -> new RuntimeException(\"Task not found: \" + id));\n        existing.setTitle(updatedTask.getTitle());\n        existing.setDescription(updatedTask.getDescription());\n        existing.setStatus(updatedTask.getStatus());\n        existing.setPriority(updatedTask.getPriority());\n        existing.setUpdatedAt(LocalDateTime.now());\n        return taskRepository.save(existing);\n    }\n\n    public boolean deleteTask(Long id) {\n        if (taskRepository.existsById(id)) {\n            taskRepository.deleteById(id);\n            return true;\n        }\n        return false;\n    }\n\n    // ============================================================\n    // VULNERABILITY S1 — SQL Injection CRITICAL\n    // Recherche par titre avec concaténation directe\n    // ============================================================\n    @SuppressWarnings(\"unchecked\")\n    public List<Task> searchTasksByTitle(String title) {\n        // Fixed: Use parameterized query to prevent SQL injection\n        String sql = \"SELECT t FROM Task t WHERE t.title = :title\";\n        return entityManager.createQuery(sql, Task.class)\n                .setParameter(\"title\", title)\n                .getResultList();\n    }\n\n    // ============================================================\n    // VULNERABILITY S5 — Resource Leak MEDIUM\n    // FileInputStream ouvert sans try-with-resources ni close()\n    // ============================================================\n    public String readTaskConfig(String configPath) {\n        StringBuilder content = new StringBuilder();\n        try (FileInputStream fis = new FileInputStream(configPath)) {\n            int ch;\n            while ((ch = fis.read()) != -1) {\n                content.append((char) ch);\n            }\n        } catch (IOException e) {\n            logger.error(\"Error reading config: {}\", e.getMessage(), e);\n        }\n        return content.toString();\n    }\n\n    // ============================================================\n    // REFACTORED: Reduced cognitive complexity by extracting validation\n    // and using helper methods\n    // ============================================================\n\n    private String validateTask(Task task) {\n        if (task == null) {\n            return ERROR_TASK_NULL;\n        }\n        if (task.getTitle() == null || task.getTitle().isEmpty()) {\n            return ERROR_TITLE_REQUIRED;\n        }\n        if (task.getDescription() == null || task.getDescription().isEmpty()) {\n            return ERROR_DESCRIPTION_REQUIRED;\n        }\n        if (task.getPriority() == null || task.getPriority() < 0 || task.getPriority() > 10) {\n            return ERROR_PRIORITY_INVALID;\n        }\n        return null;\n    }\n\n    private void handleAdminCreate(Task task, boolean isUrgent, boolean isBulk) {\n        if (isBulk && isUrgent) {\n            task.setPriority(10);\n            task.setStatus(Task.TaskStatus.IN_PROGRESS);\n            logger.info(\"Bulk urgent admin create: {}\", task.getTitle());\n        } else if (isUrgent) {\n            task.setPriority(9);\n            task.setStatus(Task.TaskStatus.IN_PROGRESS);\n        } else {\n            task.setPriority(5);\n        }\n        taskRepository.save(task);\n    }\n\n    private void handleUserCreate(Task task, boolean isUrgent) {\n        if (isUrgent) {\n            task.setPriority(7);\n            task.setStatus(Task.TaskStatus.TODO);\n        } else {\n            task.setPriority(3);\n        }\n        taskRepository.save(task);\n    }\n\n    private void handleAdminUpdate(Task task) {\n        task.setUpdatedAt(LocalDateTime.now());\n        taskRepository.save(task);\n    }\n\n    private void handleUserUpdate(Task task, boolean isUrgent) {\n        if (isUrgent) {\n            task.setPriority(8);\n        }\n        task.setUpdatedAt(LocalDateTime.now());\n        taskRepository.save(task);\n    }\n\n    public String processTaskWorkflow(Task task, String action, String userRole, boolean isUrgent, boolean isBulk) {\n        // Validate task first\n        String validationError = validateTask(task);\n        if (validationError != null) {\n            return validationError;\n        }\n\n        switch (action) {\n            case ACTION_CREATE:\n                return handleCreateAction(task, userRole, isUrgent, isBulk);\n            case ACTION_UPDATE:\n                return handleUpdateAction(task, userRole, isUrgent);\n            case ACTION_DELETE:\n                return handleDeleteAction(task, userRole);\n            case ACTION_COMPLETE:\n                task.setStatus(Task.TaskStatus.DONE);\n                task.setUpdatedAt(LocalDateTime.now());\n                taskRepository.save(task);\n                return \"TASK_COMPLETED\";\n            case ACTION_CANCEL:\n                task.setStatus(Task.TaskStatus.CANCELLED);\n                task.setUpdatedAt(LocalDateTime.now());\n                taskRepository.save(task);\n                return \"TASK_CANCELLED\";\n            default:\n                return \"UNKNOWN_ACTION\";\n        }\n    }\n\n    private String handleCreateAction(Task task, String userRole, boolean isUrgent, boolean isBulk) {\n        if (ROLE_ADMIN.equals(userRole)) {\n            handleAdminCreate(task, isUrgent, isBulk);\n            if (isBulk && isUrgent) {\n                return \"BULK_URGENT_ADMIN_CREATE\";\n            } else if (isUrgent) {\n                return \"URGENT_ADMIN_CREATE\";\n            } else {\n                return \"NORMAL_ADMIN_CREATE\";\n            }\n        } else if (ROLE_USER.equals(userRole)) {\n            handleUserCreate(task, isUrgent);\n            return isUrgent ? \"URGENT_USER_CREATE\" : \"NORMAL_USER_CREATE\";\n        } else {\n            return \"ERROR: unknown role\";\n        }\n    }\n\n    private String handleUpdateAction(Task task, String userRole, boolean isUrgent) {\n        if (ROLE_ADMIN.equals(userRole)) {\n            handleAdminUpdate(task);\n            return \"ADMIN_UPDATE\";\n        } else if (ROLE_USER.equals(userRole)) {\n            handleUserUpdate(task, isUrgent);\n            return isUrgent ? \"URGENT_USER_UPDATE\" : \"NORMAL_USER_UPDATE\";\n        } else {\n            return \"ERROR: unknown role\";\n        }\n    }\n\n    private String handleDeleteAction(Task task, String userRole) {\n        if (ROLE_ADMIN.equals(userRole)) {\n            taskRepository.deleteById(task.getId());\n            return \"ADMIN_DELETE\";\n        } else {\n            return \"ERROR: insufficient permissions\";\n        }\n    }\n\n    // Validation admin basique\n    public boolean validateAdmin(String username, String password) {\n        // Fixed: Use environment-based credentials instead of hardcoded values\n        return adminUsername != null && adminUsername.equals(username) &&\n               adminPassword != null && adminPassword.equals(password);\n    }\n}\n";
const headControllerContent = "package com.pfe.devsecops.controller;\n\nimport com.pfe.devsecops.dto.TaskDTO;\nimport com.pfe.devsecops.model.Task;\nimport com.pfe.devsecops.service.TaskService;\nimport org.springframework.beans.factory.annotation.Autowired;\nimport org.springframework.http.ResponseEntity;\nimport org.springframework.web.bind.annotation.*;\n\nimport java.util.List;\n\n@RestController\n@RequestMapping(\"/api/tasks\")\npublic class TaskController {\n\n    @Autowired\n    private TaskService taskService;\n\n    @GetMapping\n    public ResponseEntity<List<Task>> getAllTasks() {\n        return ResponseEntity.ok(taskService.getAllTasks());\n    }\n\n    // VULNERABILITY Z4 — IDOR : pas de vérification ownership\n    // N'importe quel user authentifié peut voir la tâche de n'importe qui\n    // en changeant l'id dans l'URL\n    @GetMapping(\"/{id}\")\n    public ResponseEntity<Task> getTaskById(@PathVariable Long id) {\n        return taskService.getTaskById(id)\n                .map(ResponseEntity::ok)\n                .orElse(ResponseEntity.notFound().build());\n    }\n\n    @PostMapping\n    public ResponseEntity<TaskDTO> createTask(@RequestBody TaskDTO task) {\n        return ResponseEntity.ok(taskService.createTask(task));\n    }\n\n    @PutMapping(\"/{id}\")\n    public ResponseEntity<TaskDTO> updateTask(@PathVariable Long id, @RequestBody TaskDTO task) {\n        return ResponseEntity.ok(taskService.updateTask(id, task));\n    }\n\n    @DeleteMapping(\"/{id}\")\n    public ResponseEntity<Void> deleteTask(@PathVariable Long id) {\n        taskService.deleteTask(id);\n        return ResponseEntity.noContent().build();\n    }\n\n    // VULNERABILITY S1 — endpoint qui expose la SQL injection\n    @GetMapping(\"/search\")\n    public ResponseEntity<List<Task>> searchTasks(@RequestParam String title) {\n        // title est passé directement sans sanitization → SQL injection\n        return ResponseEntity.ok(taskService.searchTasksByTitle(title));\n    }\n\n    @PostMapping(\"/{id}/process\")\n    public ResponseEntity<String> processTask(@PathVariable Long id,\n                                               @RequestParam String action,\n                                               @RequestParam(defaultValue = \"USER\") String role,\n                                               @RequestParam(defaultValue = \"false\") boolean urgent,\n                                               @RequestParam(defaultValue = \"false\") boolean bulk) {\n        Task task = taskService.getTaskById(id)\n                .orElseThrow(() -> new RuntimeException(\"Task not found\"));\n        return ResponseEntity.ok(taskService.processTaskWorkflow(task, action, role, urgent, bulk));\n    }\n}\n";
const headDtoContent = "package com.pfe.devsecops.dto;\n\nimport java.time.LocalDateTime;\n\n/**\n * Persistence-decoupled representation of a task used at the HTTP boundary.\n *\n * <p>This type intentionally contains no persistence imports, annotations or\n * references to persistence entities. The task status is carried as a plain\n * String whose accepted values are TODO, IN_PROGRESS, DONE and CANCELLED;\n * the service layer performs the explicit, type-safe conversion to and from\n * the persistent status representation.</p>\n */\npublic class TaskDTO {\n\n    private Long id;\n\n    private String title;\n\n    private String description;\n\n    /** Task status name: TODO, IN_PROGRESS, DONE or CANCELLED. */\n    private String status;\n\n    private Integer priority;\n\n    private LocalDateTime createdAt;\n\n    private LocalDateTime updatedAt;\n\n    private Long userId;\n\n    public TaskDTO() {\n        // Default constructor for JSON deserialization.\n    }\n\n    public TaskDTO(Long id,\n                   String title,\n                   String description,\n                   String status,\n                   Integer priority,\n                   LocalDateTime createdAt,\n                   LocalDateTime updatedAt,\n                   Long userId) {\n        this.id = id;\n        this.title = title;\n        this.description = description;\n        this.status = status;\n        this.priority = priority;\n        this.createdAt = createdAt;\n        this.updatedAt = updatedAt;\n        this.userId = userId;\n    }\n\n    public Long getId() {\n        return id;\n    }\n\n    public void setId(Long id) {\n        this.id = id;\n    }\n\n    public String getTitle() {\n        return title;\n    }\n\n    public void setTitle(String title) {\n        this.title = title;\n    }\n\n    public String getDescription() {\n        return description;\n    }\n\n    public void setDescription(String description) {\n        this.description = description;\n    }\n\n    public String getStatus() {\n        return status;\n    }\n\n    public void setStatus(String status) {\n        this.status = status;\n    }\n\n    public Integer getPriority() {\n        return priority;\n    }\n\n    public void setPriority(Integer priority) {\n        this.priority = priority;\n    }\n\n    public LocalDateTime getCreatedAt() {\n        return createdAt;\n    }\n\n    public void setCreatedAt(LocalDateTime createdAt) {\n        this.createdAt = createdAt;\n    }\n\n    public LocalDateTime getUpdatedAt() {\n        return updatedAt;\n    }\n\n    public void setUpdatedAt(LocalDateTime updatedAt) {\n        this.updatedAt = updatedAt;\n    }\n\n    public Long getUserId() {\n        return userId;\n    }\n\n    public void setUserId(Long userId) {\n        this.userId = userId;\n    }\n}\n";
const headServiceContent = "package com.pfe.devsecops.service;\n\nimport com.pfe.devsecops.dto.TaskDTO;\nimport com.pfe.devsecops.model.Task;\nimport com.pfe.devsecops.model.User;\nimport com.pfe.devsecops.repository.TaskRepository;\nimport com.pfe.devsecops.repository.UserRepository;\nimport org.slf4j.Logger;\nimport org.slf4j.LoggerFactory;\nimport org.springframework.beans.factory.annotation.Value;\nimport org.springframework.http.HttpStatus;\nimport org.springframework.stereotype.Service;\nimport org.springframework.web.server.ResponseStatusException;\n\nimport javax.persistence.EntityManager;\nimport javax.persistence.PersistenceContext;\nimport java.io.FileInputStream;\nimport java.io.IOException;\nimport java.time.LocalDateTime;\nimport java.util.List;\nimport java.util.Optional;\n\n@Service\npublic class TaskService {\n\n    private static final Logger logger = LoggerFactory.getLogger(TaskService.class);\n\n    // Constants for error messages\n    private static final String ERROR_TASK_NULL = \"ERROR: task is null\";\n    private static final String ERROR_TITLE_REQUIRED = \"ERROR: title required\";\n    private static final String ERROR_DESCRIPTION_REQUIRED = \"ERROR: description required\";\n    private static final String ERROR_PRIORITY_INVALID = \"ERROR: priority invalid\";\n    private static final String ROLE_ADMIN = \"ADMIN\";\n    private static final String ROLE_USER = \"USER\";\n    private static final String ACTION_CREATE = \"CREATE\";\n    private static final String ACTION_UPDATE = \"UPDATE\";\n    private static final String ACTION_DELETE = \"DELETE\";\n    private static final String ACTION_COMPLETE = \"COMPLETE\";\n    private static final String ACTION_CANCEL = \"CANCEL\";\n\n    @Value(\"${db.password:}\")\n    private String dbPassword;\n\n    @Value(\"${admin.username:}\")\n    private String adminUsername;\n\n    @Value(\"${admin.password:}\")\n    private String adminPassword;\n\n    private final TaskRepository taskRepository;\n\n    private final UserRepository userRepository;\n\n    @PersistenceContext\n    private EntityManager entityManager;\n\n    public TaskService(TaskRepository taskRepository, UserRepository userRepository) {\n        this.taskRepository = taskRepository;\n        this.userRepository = userRepository;\n    }\n\n    // ============================================================\n    // CRUD de base\n    // ============================================================\n\n    public List<Task> getAllTasks() {\n        return taskRepository.findAll();\n    }\n\n    public Optional<Task> getTaskById(Long id) {\n        return taskRepository.findById(id);\n    }\n\n    public List<Task> getTasksByUser(Long userId) {\n        return taskRepository.findByUserId(userId);\n    }\n\n    public Task createTask(Task task) {\n        task.setCreatedAt(LocalDateTime.now());\n        return taskRepository.save(task);\n    }\n\n    // ============================================================\n    // DTO-based create : le contrat HTTP n'expose plus l'entité JPA\n    // ============================================================\n    public TaskDTO createTask(TaskDTO taskDto) {\n        Task task = new Task();\n        task.setTitle(taskDto.getTitle());\n        task.setDescription(taskDto.getDescription());\n        task.setPriority(taskDto.getPriority());\n        if (taskDto.getStatus() != null) {\n            task.setStatus(parseStatus(taskDto.getStatus()));\n        }\n        if (taskDto.getUserId() != null) {\n            User owner = userRepository.findById(taskDto.getUserId())\n                    .orElseThrow(() -> new RuntimeException(\"User not found: \" + taskDto.getUserId()));\n            task.setUser(owner);\n        }\n        task.setCreatedAt(LocalDateTime.now());\n        return toDto(taskRepository.save(task));\n    }\n\n    public Task updateTask(Long id, Task updatedTask) {\n        Task existing = taskRepository.findById(id)\n                .orElseThrow(() -> new RuntimeException(\"Task not found: \" + id));\n        existing.setTitle(updatedTask.getTitle());\n        existing.setDescription(updatedTask.getDescription());\n        existing.setStatus(updatedTask.getStatus());\n        existing.setPriority(updatedTask.getPriority());\n        existing.setUpdatedAt(LocalDateTime.now());\n        return taskRepository.save(existing);\n    }\n\n    // ============================================================\n    // DTO-based update : la relation user existante reste inchangée\n    // ============================================================\n    public TaskDTO updateTask(Long id, TaskDTO updatedTask) {\n        Task existing = taskRepository.findById(id)\n                .orElseThrow(() -> new RuntimeException(\"Task not found: \" + id));\n        existing.setTitle(updatedTask.getTitle());\n        existing.setDescription(updatedTask.getDescription());\n        existing.setStatus(parseStatus(updatedTask.getStatus()));\n        existing.setPriority(updatedTask.getPriority());\n        existing.setUpdatedAt(LocalDateTime.now());\n        return toDto(taskRepository.save(existing));\n    }\n\n    private Task.TaskStatus parseStatus(String status) {\n        if (status == null) {\n            return null;\n        }\n        try {\n            return Task.TaskStatus.valueOf(status);\n        } catch (IllegalArgumentException e) {\n            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, \"Invalid task status: \" + status, e);\n        }\n    }\n\n    private TaskDTO toDto(Task task) {\n        TaskDTO dto = new TaskDTO();\n        dto.setId(task.getId());\n        dto.setTitle(task.getTitle());\n        dto.setDescription(task.getDescription());\n        dto.setStatus(task.getStatus() == null ? null : task.getStatus().name());\n        dto.setPriority(task.getPriority());\n        dto.setCreatedAt(task.getCreatedAt());\n        dto.setUpdatedAt(task.getUpdatedAt());\n        dto.setUserId(task.getUser() == null ? null : task.getUser().getId());\n        return dto;\n    }\n\n    public boolean deleteTask(Long id) {\n        if (taskRepository.existsById(id)) {\n            taskRepository.deleteById(id);\n            return true;\n        }\n        return false;\n    }\n\n    // ============================================================\n    // VULNERABILITY S1 — SQL Injection CRITICAL\n    // Recherche par titre avec concaténation directe\n    // ============================================================\n    @SuppressWarnings(\"unchecked\")\n    public List<Task> searchTasksByTitle(String title) {\n        // Fixed: Use parameterized query to prevent SQL injection\n        String sql = \"SELECT t FROM Task t WHERE t.title = :title\";\n        return entityManager.createQuery(sql, Task.class)\n                .setParameter(\"title\", title)\n                .getResultList();\n    }\n\n    // ============================================================\n    // VULNERABILITY S5 — Resource Leak MEDIUM\n    // FileInputStream ouvert sans try-with-resources ni close()\n    // ============================================================\n    public String readTaskConfig(String configPath) {\n        StringBuilder content = new StringBuilder();\n        try (FileInputStream fis = new FileInputStream(configPath)) {\n            int ch;\n            while ((ch = fis.read()) != -1) {\n                content.append((char) ch);\n            }\n        } catch (IOException e) {\n            logger.error(\"Error reading config: {}\", e.getMessage(), e);\n        }\n        return content.toString();\n    }\n\n    // ============================================================\n    // REFACTORED: Reduced cognitive complexity by extracting validation\n    // and using helper methods\n    // ============================================================\n\n    private String validateTask(Task task) {\n        if (task == null) {\n            return ERROR_TASK_NULL;\n        }\n        if (task.getTitle() == null || task.getTitle().isEmpty()) {\n            return ERROR_TITLE_REQUIRED;\n        }\n        if (task.getDescription() == null || task.getDescription().isEmpty()) {\n            return ERROR_DESCRIPTION_REQUIRED;\n        }\n        if (task.getPriority() == null || task.getPriority() < 0 || task.getPriority() > 10) {\n            return ERROR_PRIORITY_INVALID;\n        }\n        return null;\n    }\n\n    private void handleAdminCreate(Task task, boolean isUrgent, boolean isBulk) {\n        if (isBulk && isUrgent) {\n            task.setPriority(10);\n            task.setStatus(Task.TaskStatus.IN_PROGRESS);\n            logger.info(\"Bulk urgent admin create: {}\", task.getTitle());\n        } else if (isUrgent) {\n            task.setPriority(9);\n            task.setStatus(Task.TaskStatus.IN_PROGRESS);\n        } else {\n            task.setPriority(5);\n        }\n        taskRepository.save(task);\n    }\n\n    private void handleUserCreate(Task task, boolean isUrgent) {\n        if (isUrgent) {\n            task.setPriority(7);\n            task.setStatus(Task.TaskStatus.TODO);\n        } else {\n            task.setPriority(3);\n        }\n        taskRepository.save(task);\n    }\n\n    private void handleAdminUpdate(Task task) {\n        task.setUpdatedAt(LocalDateTime.now());\n        taskRepository.save(task);\n    }\n\n    private void handleUserUpdate(Task task, boolean isUrgent) {\n        if (isUrgent) {\n            task.setPriority(8);\n        }\n        task.setUpdatedAt(LocalDateTime.now());\n        taskRepository.save(task);\n    }\n\n    public String processTaskWorkflow(Task task, String action, String userRole, boolean isUrgent, boolean isBulk) {\n        // Validate task first\n        String validationError = validateTask(task);\n        if (validationError != null) {\n            return validationError;\n        }\n\n        switch (action) {\n            case ACTION_CREATE:\n                return handleCreateAction(task, userRole, isUrgent, isBulk);\n            case ACTION_UPDATE:\n                return handleUpdateAction(task, userRole, isUrgent);\n            case ACTION_DELETE:\n                return handleDeleteAction(task, userRole);\n            case ACTION_COMPLETE:\n                task.setStatus(Task.TaskStatus.DONE);\n                task.setUpdatedAt(LocalDateTime.now());\n                taskRepository.save(task);\n                return \"TASK_COMPLETED\";\n            case ACTION_CANCEL:\n                task.setStatus(Task.TaskStatus.CANCELLED);\n                task.setUpdatedAt(LocalDateTime.now());\n                taskRepository.save(task);\n                return \"TASK_CANCELLED\";\n            default:\n                return \"UNKNOWN_ACTION\";\n        }\n    }\n\n    private String handleCreateAction(Task task, String userRole, boolean isUrgent, boolean isBulk) {\n        if (ROLE_ADMIN.equals(userRole)) {\n            handleAdminCreate(task, isUrgent, isBulk);\n            if (isBulk && isUrgent) {\n                return \"BULK_URGENT_ADMIN_CREATE\";\n            } else if (isUrgent) {\n                return \"URGENT_ADMIN_CREATE\";\n            } else {\n                return \"NORMAL_ADMIN_CREATE\";\n            }\n        } else if (ROLE_USER.equals(userRole)) {\n            handleUserCreate(task, isUrgent);\n            return isUrgent ? \"URGENT_USER_CREATE\" : \"NORMAL_USER_CREATE\";\n        } else {\n            return \"ERROR: unknown role\";\n        }\n    }\n\n    private String handleUpdateAction(Task task, String userRole, boolean isUrgent) {\n        if (ROLE_ADMIN.equals(userRole)) {\n            handleAdminUpdate(task);\n            return \"ADMIN_UPDATE\";\n        } else if (ROLE_USER.equals(userRole)) {\n            handleUserUpdate(task, isUrgent);\n            return isUrgent ? \"URGENT_USER_UPDATE\" : \"NORMAL_USER_UPDATE\";\n        } else {\n            return \"ERROR: unknown role\";\n        }\n    }\n\n    private String handleDeleteAction(Task task, String userRole) {\n        if (ROLE_ADMIN.equals(userRole)) {\n            taskRepository.deleteById(task.getId());\n            return \"ADMIN_DELETE\";\n        } else {\n            return \"ERROR: insufficient permissions\";\n        }\n    }\n\n    // Validation admin basique\n    public boolean validateAdmin(String username, String password) {\n        // Fixed: Use environment-based credentials instead of hardcoded values\n        return adminUsername != null && adminUsername.equals(username) &&\n               adminPassword != null && adminPassword.equals(password);\n    }\n}\n";
const taskModelContent = "package com.pfe.devsecops.model;\n\nimport lombok.Data;\nimport lombok.NoArgsConstructor;\nimport lombok.AllArgsConstructor;\n\nimport javax.persistence.*;\nimport java.time.LocalDateTime;\n\n@Entity\n@Table(name = \"tasks\")\n@Data\n@NoArgsConstructor\n@AllArgsConstructor\npublic class Task {\n\n    @Id\n    @GeneratedValue(strategy = GenerationType.IDENTITY)\n    private Long id;\n\n    @Column(nullable = false)\n    private String title;\n\n    @Column(length = 2000)\n    private String description;\n\n    @Enumerated(EnumType.STRING)\n    private TaskStatus status = TaskStatus.TODO;\n\n    private Integer priority;\n\n    private LocalDateTime createdAt = LocalDateTime.now();\n\n    private LocalDateTime updatedAt;\n\n    // VULNERABILITY S4 : user peut être null → NullPointerException si on appelle getUser().getUsername()\n    @ManyToOne\n    @JoinColumn(name = \"user_id\")\n    private User user;\n\n    public enum TaskStatus {\n        TODO, IN_PROGRESS, DONE, CANCELLED\n    }\n\n    // Méthode qui retourne le nom du propriétaire SANS vérification null — SonarQube Bug HIGH\n    public String getOwnerName() {\n        return user.getUsername(); // NPE si user == null\n    }\n}\n";

const CONTROLLER_OLD_SHA = '81619b128f913dd5fe36e3f02a88b0c2e1453e36';
const CONTROLLER_NEW_SHA = 'b3089aa09a996d686257508bd4f2aad06414ff14';
const DTO_NEW_SHA = '2fd6e4ab674261fa26e93849eae01f96c132a9a9';
const SERVICE_OLD_SHA = '9309b455f7d09b50ec039d1cf18bd068d1b21ef7';
const SERVICE_NEW_SHA = '705959410d6d540286bbdbc7a2c5cff02a5b3fc8';
const TASK_MODEL_SHA = 'f'.repeat(40);

const REAL_FILE_RESULTS = [
  { targetFile: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', fileOperation: 'MODIFY', oldSha: CONTROLLER_OLD_SHA, newSha: CONTROLLER_NEW_SHA },
  { targetFile: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java', fileOperation: 'CREATE', oldSha: null, newSha: DTO_NEW_SHA },
  { targetFile: 'src/main/java/com/pfe/devsecops/service/TaskService.java', fileOperation: 'MODIFY', oldSha: SERVICE_OLD_SHA, newSha: SERVICE_NEW_SHA },
];

const CONTENT_TABLE: Record<string, Record<string, { content: string; blobSha: string }>> = {
  'src/main/java/com/pfe/devsecops/controller/TaskController.java': {
    [BASE_SHA]: { content: baseControllerContent, blobSha: CONTROLLER_OLD_SHA },
    [HEAD_SHA]: { content: headControllerContent, blobSha: CONTROLLER_NEW_SHA },
  },
  'src/main/java/com/pfe/devsecops/dto/TaskDTO.java': {
    [HEAD_SHA]: { content: headDtoContent, blobSha: DTO_NEW_SHA },
  },
  'src/main/java/com/pfe/devsecops/service/TaskService.java': {
    [BASE_SHA]: { content: baseServiceContent, blobSha: SERVICE_OLD_SHA },
    [HEAD_SHA]: { content: headServiceContent, blobSha: SERVICE_NEW_SHA },
  },
  [TASK_MODEL_PATH]: {
    [BASE_SHA]: { content: taskModelContent, blobSha: TASK_MODEL_SHA },
  },
};

const admin = { id: 'admin-1', role: 'admin' };

function makeFixture(overrides: any = {}) {
  const incidentId = overrides.incidentId || 'incident-pr34';
  const requestId = 'req-r67';
  const batchId = 'batch-r67';
  const expectedBranch = `fix/pfe-${incidentId}-${requestId}`;
  const fixRequest: any = {
    status: 'VALIDATED', requestId, batchId, batchKey: batchId, attemptCount: 2,
    findingId: 'f1', findingIds: ['f1', 'f2'], prNumber: PR, prHeadSha: HEAD_SHA,
    validationTargetSha: null, baselineSha: BASE_SHA,
    fileResults: REAL_FILE_RESULTS,
    ...overrides.fixRequest,
  };
  const requiredStages = ['build', 'tests', 'sonar', 'docker', 'trivy', 'owasp'].map(stage => ({ stage, required: true, status: 'PASSED' }))
    .concat([{ stage: 'zap', required: false, status: 'NOT_RUN' }]);
  const validation: any = overrides.validation === null ? {} : {
    checkoutSha: HEAD_SHA, expectedPrHeadSha: HEAD_SHA, correlationVerified: true, sonarCorrelationVerified: true,
    jenkinsStatus: 'SUCCESS', sonarStatus: 'OK', requiredStages,
    findingResults: [{ findingId: 'f1', result: 'VALID', evidence: 'e1' }, { findingId: 'f2', result: 'VALID', evidence: 'e2' }],
    derived: { pipelineHealth: { build: 'SUCCESS', tests: 'SUCCESS', sonarQualityGate: 'OK', trivy: 'OK', owasp: 'OK', zap: 'UNKNOWN', technicalFailure: null, requiredStagesStatus: 'COMPLETE' } },
    mergeAuthorization: {
      authorization: 'MERGE_READY', remediationResult: 'VALIDATED', regressionResult: 'CLEAN', headVerificationResult: 'PASS',
      blockingReasons: [], technicalReasons: [], advisories: [{ code: 'SCANNER_FINDING_REVIEW_UNPROVEN_COMPARABILITY', message: 'x' }],
      authorizedSha: HEAD_SHA, correctiveActionAllowed: false, computedAt: '2026-09-18T23:48:00.556Z', forSha: HEAD_SHA,
    },
    ...overrides.validation,
  };
  const prValidationRequest: any = overrides.prValidationRequest === null ? undefined : {
    validationRequestId: 'vr-r67', status: 'COMPLETED', expectedPrHeadSha: HEAD_SHA, prValidationJob: buildPrValidationJobName(JOB, PR),
    ...overrides.prValidationRequest,
  };
  const incident: any = {
    id: incidentId, projectId: 'project-1', status: 'completed',
    prUrl: `https://github.com/${REPO}/pull/${PR}`, jenkinsJobName: JOB, buildNumber: 147,
    metadata: { fixRequest, validation, ...(prValidationRequest ? { prValidationRequest } : {}) },
  };
  const project: any = { id: 'project-1', githubRepo: REPO, githubToken: null, jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:x', jenkinsJobName: JOB, sonarqubeKey: 'key' };
  incident.project = project;
  const incidentRepo: any = { findOne: async () => incident, update: async (_id: string, patch: any) => Object.assign(incident, patch) };
  const projectRepo: any = { findOne: async () => project };
  let tail = Promise.resolve();
  const repository: any = {
    manager: { transaction: async (fn: any) => {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try { return await fn({ getRepository: (entity: any) => entity?.name === 'Project' ? projectRepo : incidentRepo }); }
      finally { release(); }
    } },
    findOne: incidentRepo.findOne, update: incidentRepo.update,
  };
  const service = new IncidentsService(repository, projectRepo, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  return { incident, project, service, incidentId, requestId, batchId, expectedBranch };
}

function mockGithub(remoteHeadSha: string, expectedBranch: string, fetchCallLog: string[]) {
  return (async (url: any) => {
    const value = String(url);
    fetchCallLog.push(value);
    if (value.includes('/pulls/')) {
      return new Response(JSON.stringify({ state: 'open', head: { sha: remoteHeadSha, ref: expectedBranch } }), { status: 200 });
    }
    const contentsMatch = value.match(/\/contents\/(.+)\?ref=(.+)$/);
    if (contentsMatch) {
      const path = decodeURIComponent(contentsMatch[1]);
      const ref = decodeURIComponent(contentsMatch[2]);
      const entry = CONTENT_TABLE[path]?.[ref];
      if (!entry) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ sha: entry.blobSha, encoding: 'base64', content: Buffer.from(entry.content, 'utf8').toString('base64') }), { status: 200 });
    }
    throw new Error('unexpected URL ' + value);
  }) as any;
}

async function main() {
  const originalFetch = globalThis.fetch;
  try {

  // ── CASE A — the real PR34 shape: VALIDATED + COMPLETED + exact same SHA
  // + old MERGE_READY + R66 PROVEN_DEFECT => BLOCKED ─────────────────────
  {
    const { service, incident, expectedBranch } = makeFixture({});
    const calls: string[] = [];
    globalThis.fetch = mockGithub(HEAD_SHA, expectedBranch, calls);
    const res: any = await service.recomputePrValidationPolicy(incident.id, admin);
    assert.equal(res.mergeAuthorization.authorization, 'BLOCKED', 'CASE A: PROVEN_DEFECT must block');
    assert.ok(res.mergeAuthorization.blockingReasons.includes('DEFAULT_VALUE_SEMANTICS_REGRESSION'));
    assert.equal(res.mergeAuthorization.correctiveActionAllowed, true);
    assert.equal(res.defaultValueSemantics.verdict, 'PROVEN_DEFECT');
    assert.equal(incident.metadata.validation.mergeAuthorization.authorization, 'BLOCKED', 'persisted');
    assert.equal(incident.metadata.fixRequest.status, 'VALIDATED', 'fixRequest.status must NOT be forced back to PR_CREATED');
    assert.equal(incident.metadata.prValidationRequest.status, 'COMPLETED', 'prValidationRequest untouched');
    assert.equal(calls.some(c => c.includes('buildWithParameters') || c.includes('crumbIssuer')), false, 'never talks to Jenkins build endpoints');
    console.log('CASE A (PR34 real shape, PROVEN_DEFECT -> BLOCKED): PASS');
  }

  // ── CASE B — PR head moved => reject, no recomputation ─────────────────
  {
    const { service, incident, expectedBranch } = makeFixture({});
    const before = JSON.stringify(incident.metadata.validation.mergeAuthorization);
    globalThis.fetch = mockGithub('f'.repeat(40), expectedBranch, []);
    await assert.rejects(() => service.recomputePrValidationPolicy(incident.id, admin), /changé depuis la validation/);
    assert.equal(JSON.stringify(incident.metadata.validation.mergeAuthorization), before, 'CASE B: no mutation on reject');
    console.log('CASE B (PR head moved -> reject): PASS');
  }

  // ── CASE C — checkout SHA mismatch => reject ────────────────────────────
  {
    const { service, incident, expectedBranch } = makeFixture({ validation: { checkoutSha: 'a'.repeat(40) } });
    globalThis.fetch = mockGithub(HEAD_SHA, expectedBranch, []);
    await assert.rejects(() => service.recomputePrValidationPolicy(incident.id, admin), /ne correspondent pas exactement/);
    console.log('CASE C (checkout SHA mismatch -> reject): PASS');
  }

  // ── CASE D — prValidationRequest QUEUED/RUNNING => reject ──────────────
  for (const status of ['QUEUED', 'RUNNING']) {
    const { service, incident, expectedBranch } = makeFixture({ prValidationRequest: { status } });
    globalThis.fetch = mockGithub(HEAD_SHA, expectedBranch, []);
    await assert.rejects(() => service.recomputePrValidationPolicy(incident.id, admin), /Aucune validation PR terminée/);
    console.log('CASE D (prValidationRequest ' + status + ' -> reject): PASS');
  }

  // ── CASE E — missing completed validation evidence => reject ───────────
  {
    const { service, incident, expectedBranch } = makeFixture({ validation: null });
    globalThis.fetch = mockGithub(HEAD_SHA, expectedBranch, []);
    await assert.rejects(() => service.recomputePrValidationPolicy(incident.id, admin), /Aucune preuve de validation/);
    console.log('CASE E (missing validation -> reject): PASS');
  }
  {
    const { service, incident, expectedBranch } = makeFixture({ validation: { mergeAuthorization: undefined } });
    globalThis.fetch = mockGithub(HEAD_SHA, expectedBranch, []);
    await assert.rejects(() => service.recomputePrValidationPolicy(incident.id, admin), /Aucune autorisation de merge existante/);
    console.log('CASE E2 (missing mergeAuthorization -> reject): PASS');
  }

  // ── CASE F — R66 NO_DEFECT => existing clean candidate remains MERGE_READY
  {
    const fixedDto = headDtoContent.replace('private String status;', 'private String status = "TODO";');
    const table: any = JSON.parse(JSON.stringify(CONTENT_TABLE));
    table['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'][HEAD_SHA].content = fixedDto;
    const { service, incident, expectedBranch } = makeFixture({});
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('/pulls/')) return new Response(JSON.stringify({ state: 'open', head: { sha: HEAD_SHA, ref: expectedBranch } }), { status: 200 });
      const m = value.match(/\/contents\/(.+)\?ref=(.+)$/);
      if (m) {
        const path = decodeURIComponent(m[1]), ref = decodeURIComponent(m[2]);
        const entry = table[path]?.[ref];
        if (!entry) return new Response('not found', { status: 404 });
        return new Response(JSON.stringify({ sha: entry.blobSha, encoding: 'base64', content: Buffer.from(entry.content, 'utf8').toString('base64') }), { status: 200 });
      }
      throw new Error('unexpected URL ' + value);
    }) as any;
    const res: any = await service.recomputePrValidationPolicy(incident.id, admin);
    assert.equal(res.defaultValueSemantics.verdict, 'NO_DEFECT');
    assert.equal(res.mergeAuthorization.authorization, 'MERGE_READY', 'CASE F: clean candidate stays MERGE_READY');
    console.log('CASE F (NO_DEFECT -> stays MERGE_READY): PASS');
  }

  // ── CASE G — R66 VERIFICATION_REQUIRED must NOT become a fake PROVEN_DEFECT
  {
    const { service, incident, expectedBranch } = makeFixture({});
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('/pulls/')) return new Response(JSON.stringify({ state: 'open', head: { sha: HEAD_SHA, ref: expectedBranch } }), { status: 200 });
      // Every contents fetch fails -> assembler degrades to VERIFICATION_REQUIRED
      return new Response('not found', { status: 404 });
    }) as any;
    const res: any = await service.recomputePrValidationPolicy(incident.id, admin);
    assert.equal(res.defaultValueSemantics.verdict, 'VERIFICATION_REQUIRED');
    assert.notEqual(res.mergeAuthorization.authorization, 'BLOCKED', 'CASE G: VERIFICATION_REQUIRED must never force BLOCKED');
    console.log('CASE G (VERIFICATION_REQUIRED -> not fabricated as defect): PASS');
  }

  // ── CASE H — second identical recompute is idempotent ──────────────────
  {
    const { service, incident, expectedBranch } = makeFixture({});
    globalThis.fetch = mockGithub(HEAD_SHA, expectedBranch, []);
    const first: any = await service.recomputePrValidationPolicy(incident.id, admin);
    const second: any = await service.recomputePrValidationPolicy(incident.id, admin);
    assert.equal(second.mergeAuthorization.authorization, first.mergeAuthorization.authorization);
    assert.equal(second.mergeAuthorization.authorization, 'BLOCKED');
    assert.equal(incident.metadata.fixRequest.attemptCount, 2, 'CASE H: no new WF2 attempt');
    assert.equal(incident.metadata.prValidationRequest.validationRequestId, 'vr-r67', 'CASE H: no new validationRequestId');
    assert.equal(incident.metadata.validation.policyReevaluations.length, 2, 'CASE H: bounded audit trail grows, not corrupted');
    console.log('CASE H (idempotent second call): PASS');
  }

  // ── CASE I — correct-and-revalidate's OWN precondition check accepts the
  // resulting state (authorization===BLOCKED && correctiveActionAllowed===
  // true); documented separately below whether the FULL endpoint would
  // proceed past its second gate (extractBlockingCauses). ────────────────
  {
    const { service, incident, expectedBranch } = makeFixture({});
    globalThis.fetch = mockGithub(HEAD_SHA, expectedBranch, []);
    await service.recomputePrValidationPolicy(incident.id, admin);
    const mergeAuth = incident.metadata.validation.mergeAuthorization;
    assert.equal(mergeAuth.authorization, 'BLOCKED');
    assert.equal(mergeAuth.correctiveActionAllowed, true);
    // This IS exactly correctAndRevalidate()'s own precondition check —
    // reproduced verbatim, not re-implemented differently:
    const correctAndRevalidatePreconditionPasses = !(mergeAuth.authorization !== 'BLOCKED' || mergeAuth.correctiveActionAllowed !== true);
    assert.equal(correctAndRevalidatePreconditionPasses, true, 'CASE I: mergeAuthorization gate accepts this state');
    console.log('CASE I (correct-and-revalidate precondition gate accepts BLOCKED+correctiveActionAllowed): PASS');

    // R68 CLOSED a gap this file originally documented as open: as of R68,
    // corrective-context.ts also extracts a DEFAULT_VALUE_SEMANTICS_DEFECT
    // cause from validation.defaultValueSemantics — so correctAndRevalidate's
    // second gate (buildCorrectiveContext -> extractBlockingCauses must be
    // non-empty) now ALSO passes for this candidate, even though
    // findingResults are all VALID and regression is CLEAN (neither of the
    // two older cause kinds would have fired). Proven here by calling the
    // real function, not asserted — see corrective-context.spec.ts and
    // default-value-corrective-loop.spec.ts for R68's own focused coverage.
    const { extractBlockingCauses } = await import('../validation/corrective-context');
    const blockingCauses = extractBlockingCauses(incident.metadata.validation);
    assert.equal(blockingCauses.length, 1, 'R68: a semantic cause is now extractable for this state');
    assert.equal(blockingCauses[0].type, 'DEFAULT_VALUE_SEMANTICS_DEFECT');
    console.log('CASE I-R68 (gap closed): correctAndRevalidate’s second gate now also passes — corrective-context.ts extracts a DEFAULT_VALUE_SEMANTICS_DEFECT cause');
  }

  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('same-sha-policy-reevaluation (R67): PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
