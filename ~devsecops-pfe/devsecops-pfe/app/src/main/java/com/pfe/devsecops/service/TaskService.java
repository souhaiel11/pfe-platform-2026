package com.pfe.devsecops.service;

import com.pfe.devsecops.model.Task;
import com.pfe.devsecops.repository.TaskRepository;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;

@Service
public class TaskService {

    private final TaskRepository taskRepository;

    public TaskService(TaskRepository taskRepository) {
        this.taskRepository = taskRepository;
    }

    public List<Task> findAll() { return taskRepository.findAll(); }

    public Optional<Task> findById(Long id) { return taskRepository.findById(id); }

    public Task save(Task task) { return taskRepository.save(task); }

    public Task update(Long id, Task updated) {
        return taskRepository.findById(id).map(task -> {
            task.setTitle(updated.getTitle());
            task.setDescription(updated.getDescription());
            task.setStatus(updated.getStatus());
            return taskRepository.save(task);
        }).orElseThrow(() -> new RuntimeException("Task not found: " + id));
    }

    public void delete(Long id) { taskRepository.deleteById(id); }

    public List<Task> findByStatus(String status) {
        return taskRepository.findByStatus(status);
    }
}
